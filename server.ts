import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  generateDocId,
  generateInviteCode,
  generateOpaqueToken,
  generateRecoveryCode,
  hashSecret,
  hashToken,
  runInTransaction,
  verifySecret,
} from './server/db.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_NAME = 'bf_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const VALID_ROLES = new Set(['marido', 'esposa', 'familiar']);
const VALID_FREQUENCIES = new Set(['mensal', 'bimestral', 'trimestral', 'anual']);
const VALID_PAYMENT_TYPES = new Set(['parcela', 'parcial', 'quitacao']);

const MAX_LENGTHS = {
  displayName: 80,
  email: 150,
  familyName: 80,
  description: 140,
  category: 60,
  subcategory: 60,
  paymentMethod: 40,
  notes: 500,
  billName: 100,
  debtName: 100,
  creditor: 100,
  goalName: 100,
  summary: 240,
};

interface DbUserRow {
  uid: string;
  display_name: string;
  email: string;
  password_hash: string;
  recovery_code_hash: string;
  role: 'marido' | 'esposa' | 'familiar';
  family_id: string | null;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
}

interface DbFamilyRow {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

interface AuthedRequest extends Request {
  authUser?: DbUserRow;
  sessionTokenHash?: string;
}

// In-memory SSE subscribers grouped by familyId
const familyStreams = new Map<string, Set<Response>>();

function broadcastFamilySync(familyId: string | null | undefined, scope = 'all') {
  if (!familyId) return;
  const listeners = familyStreams.get(familyId);
  if (!listeners || listeners.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: 'sync', scope, ts: Date.now() })}\n\n`;
  for (const res of listeners) {
    try {
      res.write(payload);
    } catch {
      listeners.delete(res);
    }
  }
}

function clampText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function clampAmount(val: unknown): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(Math.round(num * 100) / 100, 100_000_000);
}

function sanitizeDateISO(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeId(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!/^[a-zA-Z0-9_-]{3,120}$/.test(trimmed)) return null;
  return trimmed;
}

function addMonthsToISO(isoDate: string, monthsToAdd: number): string {
  const [yStr, mStr, dStr] = isoDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const targetMonthIndex = month + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDaysInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const safeDay = Math.min(day, maxDaysInTargetMonth);
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function formatBRLServer(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

function getTodayBrazilISO(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') return true;
  return req.secure;
}

function setSessionCookie(req: Request, res: Response, rawToken: string) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const https = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
  ];
  if (https) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response) {
  const https = isHttpsRequest(req);
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly'];
  if (https) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function extractSessionToken(req: Request): { token: string | null; viaCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length >= 16) return { token, viaCookie: false };
  }
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && cookieToken.length >= 16) {
    return { token: cookieToken, viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

function createSessionForUser(userUid: string): string {
  const rawToken = generateOpaqueToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  db.prepare(
    'INSERT INTO sessions (token_hash, user_uid, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(tokenHash, userUid, expiresAt, now.toISOString());
  return rawToken;
}

function serializeUser(row: DbUserRow) {
  return {
    uid: row.uid,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    familyId: row.family_id,
    onboardingCompleted: Boolean(row.onboarding_completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getFamilyAndMembers(familyId: string | null) {
  if (!familyId) return { family: null, members: [] };
  const famRow = db
    .prepare('SELECT id, name, owner_id, invite_code, created_at, updated_at FROM families WHERE id = ?')
    .get(familyId) as DbFamilyRow | undefined;
  if (!famRow) return { family: null, members: [] };

  const memberRows = db
    .prepare(
      'SELECT uid, display_name, role, invite_code, joined_at FROM family_members WHERE family_id = ? ORDER BY joined_at ASC'
    )
    .all(familyId) as Array<{
    uid: string;
    display_name: string;
    role: 'marido' | 'esposa' | 'familiar';
    invite_code: string | null;
    joined_at: string;
  }>;

  return {
    family: {
      id: famRow.id,
      name: famRow.name,
      ownerId: famRow.owner_id,
      inviteCode: famRow.invite_code,
      createdAt: famRow.created_at,
      updatedAt: famRow.updated_at,
    },
    members: memberRows.map((m) => ({
      uid: m.uid,
      displayName: m.display_name,
      role: m.role,
      inviteCode: m.invite_code || undefined,
      joinedAt: m.joined_at,
    })),
  };
}

function insertAuditLog(params: {
  familyId: string;
  action: 'criar' | 'editar' | 'excluir' | 'pagamento' | 'reserva';
  entityType: string;
  entityId: string;
  summary: string;
  amount?: number;
  user: DbUserRow;
}) {
  const id = generateDocId('log');
  const now = new Date().toISOString();
  const safeAmount =
    typeof params.amount === 'number' && Number.isFinite(params.amount) && params.amount >= 0
      ? clampAmount(params.amount)
      : null;

  db.prepare(
    `INSERT INTO audit_logs (
      id, family_id, action, entity_type, entity_id, summary, amount, performed_by_uid, performed_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.familyId,
    params.action,
    clampText(params.entityType, 40),
    clampText(params.entityId, 128),
    clampText(params.summary, MAX_LENGTHS.summary),
    safeAmount,
    params.user.uid,
    clampText(params.user.display_name, MAX_LENGTHS.displayName),
    now
  );
}

function getFinanceSnapshot(familyId: string) {
  const incomes = (
    db
      .prepare('SELECT * FROM incomes WHERE family_id = ? ORDER BY date DESC, created_at DESC')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    description: r.description,
    amount: Number(r.amount),
    date: r.date,
    category: r.category,
    responsibleName: r.responsible_name,
    responsibleUid: r.responsible_uid || undefined,
    notes: r.notes || '',
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const expenses = (
    db
      .prepare('SELECT * FROM expenses WHERE family_id = ? ORDER BY date DESC, created_at DESC')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    description: r.description,
    category: r.category,
    subcategory: r.subcategory,
    amount: Number(r.amount),
    date: r.date,
    paymentMethod: r.payment_method,
    responsibleName: r.responsible_name,
    responsibleUid: r.responsible_uid || undefined,
    notes: r.notes || '',
    status: r.status,
    isInstallment: Boolean(r.is_installment),
    installmentGroupId: r.installment_group_id || undefined,
    installmentNumber: r.installment_number ?? undefined,
    totalInstallments: r.total_installments ?? undefined,
    isRecurring: Boolean(r.is_recurring),
    fixedBillId: r.fixed_bill_id || undefined,
    referenceMonth: r.reference_month || undefined,
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const fixedBills = (
    db
      .prepare('SELECT * FROM fixed_bills WHERE family_id = ? ORDER BY created_at DESC')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    expectedAmount: Number(r.expected_amount),
    dueDay: Number(r.due_day),
    frequency: r.frequency,
    category: r.category,
    subcategory: r.subcategory,
    lastPaidMonth: r.last_paid_month || '',
    lastPaidDate: r.last_paid_date || '',
    lastPaidAmount: Number(r.last_paid_amount || 0),
    active: Boolean(r.active),
    notes: r.notes || '',
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const debts = (
    db
      .prepare('SELECT * FROM debts WHERE family_id = ? ORDER BY created_at DESC')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    creditor: r.creditor,
    originalAmount: Number(r.original_amount),
    currentAmount: Number(r.current_amount),
    installmentAmount: Number(r.installment_amount),
    totalInstallments: Number(r.total_installments),
    paidInstallments: Number(r.paid_installments),
    interestRate: Number(r.interest_rate || 0),
    dueDate: r.due_date,
    status: r.status,
    notes: r.notes || '',
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const debtPayments = (
    db
      .prepare('SELECT * FROM debt_payments WHERE family_id = ? ORDER BY date DESC, created_at DESC')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    debtId: r.debt_id,
    debtName: r.debt_name,
    amount: Number(r.amount),
    date: r.date,
    paymentType: r.payment_type,
    notes: r.notes || '',
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  }));

  const reserves = (
    db
      .prepare('SELECT * FROM reserves WHERE family_id = ? ORDER BY created_at DESC')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    targetAmount: Number(r.target_amount),
    currentAmount: Number(r.current_amount),
    monthlyContribution: Number(r.monthly_contribution || 0),
    notes: r.notes || '',
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const reserveMovements = (
    db
      .prepare(
        'SELECT * FROM reserve_movements WHERE family_id = ? ORDER BY date DESC, created_at DESC'
      )
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    goalId: r.goal_id,
    goalName: r.goal_name,
    type: r.type,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes || '',
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  }));

  const budgets = (
    db
      .prepare('SELECT * FROM budgets WHERE family_id = ? ORDER BY created_at DESC')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    category: r.category,
    monthlyLimit: Number(r.monthly_limit),
    month: r.month,
    createdByUid: r.created_by_uid,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const auditLogs = (
    db
      .prepare('SELECT * FROM audit_logs WHERE family_id = ? ORDER BY created_at DESC LIMIT 250')
      .all(familyId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    summary: r.summary,
    amount: r.amount !== null && r.amount !== undefined ? Number(r.amount) : undefined,
    performedByUid: r.performed_by_uid,
    performedByName: r.performed_by_name,
    createdAt: r.created_at,
  }));

  return {
    incomes,
    expenses,
    fixedBills,
    debts,
    debtPayments,
    reserves,
    reserveMovements,
    budgets,
    auditLogs,
  };
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// HTTPS redirect in production behind proxy
app.use((req: Request, res: Response, next: NextFunction) => {
  const proto = req.headers['x-forwarded-proto'];
  if (IS_PROD && typeof proto === 'string' && proto !== 'https') {
    const host = req.headers.host;
    if (host && /^[a-zA-Z0-9.-]+(:\d+)?$/.test(host)) {
      res.redirect(301, `https://${host}${req.originalUrl}`);
      return;
    }
  }
  next();
});

// Strict HTTP Security Headers & Content Security Policy (self-contained local app)
app.use((_req: Request, res: Response, next: NextFunction) => {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://aistudio.google.com https://*.google.com",
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

// Sliding-window rate limiters
const generalBuckets = new Map<string, { count: number; resetAt: number }>();
const authBuckets = new Map<string, { count: number; resetAt: number }>();

function createRateLimiter(
  buckets: Map<string, { count: number; resetAt: number }>,
  windowMs: number,
  maxReq: number
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > maxReq) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({
        error: 'Muitas tentativas em sequência. Aguarde um minuto e tente novamente.',
      });
      return;
    }
    next();
  };
}

const apiRateLimiter = createRateLimiter(generalBuckets, 60_000, 180);
const authRateLimiter = createRateLimiter(authBuckets, 60_000, 20);

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of generalBuckets.entries()) if (now > v.resetAt) generalBuckets.delete(k);
  for (const [k, v] of authBuckets.entries()) if (now > v.resetAt) authBuckets.delete(k);
}, 5 * 60_000).unref();

// Origin & CSRF header verification for state-changing API routes
function verifyRequestOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const allowedEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const isSameHost = typeof host === 'string' && originHost === host;
      const isExplicitlyAllowed = allowedEnv.includes(origin);
      if (!isSameHost && !isExplicitlyAllowed) {
        res.status(403).json({ error: 'Origem da requisição não autorizada.' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Origem inválida.' });
      return;
    }
  }

  // Require custom header on cookie-authenticated mutations when Authorization Bearer is not present
  const authHeader = req.headers.authorization;
  const cookies = parseCookies(req.headers.cookie);
  if (!authHeader && cookies[SESSION_COOKIE_NAME] && req.headers['x-requested-with'] !== 'BlessedFinance') {
    res.status(403).json({ error: 'Cabeçalho de segurança ausente.' });
    return;
  }

  next();
}

function resolveSessionUser(req: AuthedRequest): { user: DbUserRow; tokenHash: string } | null {
  const { token } = extractSessionToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
       FROM sessions s
       JOIN users u ON u.uid = s.user_uid
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as (DbUserRow & { expires_at: string }) | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { user: row, tokenHash };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const resolved = resolveSessionUser(req);
  if (!resolved) {
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    return;
  }
  req.authUser = resolved.user;
  req.sessionTokenHash = resolved.tokenHash;
  next();
}

function requireFamily(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.authUser?.family_id) {
    res.status(403).json({ error: 'Você ainda não pertence a uma família conectada.' });
    return;
  }
  const member = db
    .prepare('SELECT 1 FROM family_members WHERE family_id = ? AND uid = ?')
    .get(req.authUser.family_id, req.authUser.uid);
  if (!member) {
    res.status(403).json({ error: 'Acesso revogado para esta família.' });
    return;
  }
  next();
}

app.use('/api', apiRateLimiter, verifyRequestOrigin);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'Blessed Finance', storage: 'local-sqlite' });
});

// --- AUTH ROUTES ---
app.get('/api/auth/me', (req: AuthedRequest, res: Response) => {
  const resolved = resolveSessionUser(req);
  if (!resolved) {
    res.json({ user: null, family: null, members: [] });
    return;
  }
  const { family, members } = getFamilyAndMembers(resolved.user.family_id);
  res.json({
    user: serializeUser(resolved.user),
    family,
    members,
  });
});

app.post('/api/auth/register', authRateLimiter, (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const name = clampText(body.name, MAX_LENGTHS.displayName);
  const email = clampText(body.email, MAX_LENGTHS.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const role = typeof body.role === 'string' && VALID_ROLES.has(body.role) ? body.role : 'marido';

  if (!name) {
    res.status(400).json({ error: 'Informe seu nome para continuar.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    return;
  }

  const existing = db.prepare('SELECT uid FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'Não foi possível concluir o cadastro com este e-mail.' });
    return;
  }

  const uid = generateDocId('usr');
  const now = new Date().toISOString();
  const passwordHash = hashSecret(password);
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = hashSecret(recoveryCode.replace(/[^A-Z0-9]/g, '').toUpperCase());

  db.prepare(
    `INSERT INTO users (
      uid, display_name, email, password_hash, recovery_code_hash, role, family_id, onboarding_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`
  ).run(uid, name, email, passwordHash, recoveryCodeHash, role, now, now);

  const userRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as unknown as DbUserRow;
  const rawToken = createSessionForUser(uid);
  setSessionCookie(req, res, rawToken);

  res.status(201).json({
    user: serializeUser(userRow),
    family: null,
    members: [],
    token: rawToken,
    recoveryCode,
  });
});

app.post('/api/auth/login', authRateLimiter, (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const email = clampText(body.email, MAX_LENGTHS.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Informe e-mail e senha.' });
    return;
  }

  const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | DbUserRow
    | undefined;
  if (!userRow || !verifySecret(password, userRow.password_hash)) {
    res.status(401).json({ error: 'Credenciais inválidas. Confira os dados e tente novamente.' });
    return;
  }

  const rawToken = createSessionForUser(userRow.uid);
  setSessionCookie(req, res, rawToken);
  const { family, members } = getFamilyAndMembers(userRow.family_id);

  res.json({
    user: serializeUser(userRow),
    family,
    members,
    token: rawToken,
  });
});

app.post('/api/auth/reset-password', authRateLimiter, (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const email = clampText(body.email, MAX_LENGTHS.email).toLowerCase();
  const recoveryCode =
    typeof body.recoveryCode === 'string'
      ? body.recoveryCode.toUpperCase().replace(/[^A-Z0-9]/g, '')
      : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!email || !recoveryCode || newPassword.length < 6) {
    res.status(400).json({
      error: 'Informe e-mail, código de recuperação e uma nova senha com pelo menos 6 caracteres.',
    });
    return;
  }

  const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | DbUserRow
    | undefined;
  if (!userRow || !verifySecret(recoveryCode, userRow.recovery_code_hash)) {
    res.status(401).json({ error: 'Dados de recuperação inválidos. Verifique e tente novamente.' });
    return;
  }

  const now = new Date().toISOString();
  const newHash = hashSecret(newPassword);
  runInTransaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?').run(
      newHash,
      now,
      userRow.uid
    );
    db.prepare('DELETE FROM sessions WHERE user_uid = ?').run(userRow.uid);
  });

  res.json({ ok: true });
});

app.post('/api/auth/logout', (req: AuthedRequest, res: Response) => {
  const resolved = resolveSessionUser(req);
  if (resolved) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(resolved.tokenHash);
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/auth/reauthenticate', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const body = req.body as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!currentPassword || !verifySecret(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Senha atual incorreta. Verifique e tente novamente.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const body = req.body as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword || !verifySecret(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Senha atual incorreta.' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'A nova senha deve ter no mínimo 8 caracteres.' });
    return;
  }

  const newHash = hashSecret(newPassword);
  const now = new Date().toISOString();
  let newToken = '';
  runInTransaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?').run(
      newHash,
      now,
      user.uid
    );
    db.prepare('DELETE FROM sessions WHERE user_uid = ?').run(user.uid);
    newToken = createSessionForUser(user.uid);
  });

  setSessionCookie(req, res, newToken);
  res.json({ ok: true, token: newToken });
});

// --- FAMILY ROUTES ---
app.post('/api/family/create', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  if (user.family_id) {
    res.status(409).json({ error: 'Você já está conectado a uma família.' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const familyName = clampText(body.familyName, MAX_LENGTHS.familyName);
  const displayName = clampText(body.displayName || user.display_name, MAX_LENGTHS.displayName);
  const role =
    typeof body.role === 'string' && VALID_ROLES.has(body.role) ? body.role : user.role;

  if (!familyName || !displayName) {
    res.status(400).json({ error: 'Informe o nome da família e o seu nome.' });
    return;
  }

  const familyId = generateDocId('fam');
  let inviteCode = generateInviteCode();
  while (db.prepare('SELECT 1 FROM families WHERE invite_code = ?').get(inviteCode)) {
    inviteCode = generateInviteCode();
  }
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(familyId, familyName, user.uid, inviteCode, now, now);

    db.prepare(
      'INSERT INTO family_members (family_id, uid, display_name, role, invite_code, joined_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(familyId, user.uid, displayName, role, inviteCode, now);

    db.prepare(
      'UPDATE users SET display_name = ?, role = ?, family_id = ?, updated_at = ? WHERE uid = ?'
    ).run(displayName, role, familyId, now, user.uid);
  });

  const updatedUser = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as unknown as DbUserRow;
  const { family, members } = getFamilyAndMembers(familyId);
  res.status(201).json({ user: serializeUser(updatedUser), family, members });
});

app.post('/api/family/join', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  if (user.family_id) {
    res.status(409).json({ error: 'Você já está conectado a uma família.' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const cleanCode =
    typeof body.inviteCode === 'string'
      ? body.inviteCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      : '';
  const displayName = clampText(body.displayName || user.display_name, MAX_LENGTHS.displayName);
  const role =
    typeof body.role === 'string' && VALID_ROLES.has(body.role) ? body.role : user.role;

  if (cleanCode.length < 6 || cleanCode.length > 16) {
    res.status(400).json({ error: 'Informe um código de convite válido.' });
    return;
  }
  if (!displayName) {
    res.status(400).json({ error: 'Informe o seu nome.' });
    return;
  }

  const famRow = db
    .prepare('SELECT * FROM families WHERE invite_code = ?')
    .get(cleanCode) as DbFamilyRow | undefined;

  if (!famRow) {
    res.status(404).json({
      error: 'Código de convite não encontrado ou desativado. Verifique com seu cônjuge.',
    });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO family_members (family_id, uid, display_name, role, invite_code, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(famRow.id, user.uid, displayName, role, cleanCode, now);

    db.prepare(
      `UPDATE users
       SET display_name = ?, role = ?, family_id = ?, onboarding_completed = 1, updated_at = ?
       WHERE uid = ?`
    ).run(displayName, role, famRow.id, now, user.uid);
  });

  broadcastFamilySync(famRow.id, 'family');
  const updatedUser = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as unknown as DbUserRow;
  const { family, members } = getFamilyAndMembers(famRow.id);
  res.json({ user: serializeUser(updatedUser), family, members });
});

app.patch('/api/family/profile', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const body = req.body as Record<string, unknown>;
  const displayName = clampText(body.displayName, MAX_LENGTHS.displayName);
  const role =
    typeof body.role === 'string' && VALID_ROLES.has(body.role) ? body.role : user.role;

  if (!displayName) {
    res.status(400).json({ error: 'Informe seu nome.' });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    db.prepare('UPDATE users SET display_name = ?, role = ?, updated_at = ? WHERE uid = ?').run(
      displayName,
      role,
      now,
      user.uid
    );
    if (user.family_id) {
      db.prepare(
        'UPDATE family_members SET display_name = ?, role = ? WHERE family_id = ? AND uid = ?'
      ).run(displayName, role, user.family_id, user.uid);
    }
  });

  broadcastFamilySync(user.family_id, 'family');
  const updatedUser = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as unknown as DbUserRow;
  const { family, members } = getFamilyAndMembers(updatedUser.family_id);
  res.json({ user: serializeUser(updatedUser), family, members });
});

app.patch('/api/family/name', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const body = req.body as Record<string, unknown>;
  const name = clampText(body.name, MAX_LENGTHS.familyName);
  if (!name) {
    res.status(400).json({ error: 'Informe o nome da família.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE families SET name = ?, updated_at = ? WHERE id = ?').run(
    name,
    now,
    user.family_id!
  );

  broadcastFamilySync(user.family_id, 'family');
  const { family, members } = getFamilyAndMembers(user.family_id);
  res.json({ family, members });
});

app.post('/api/family/complete-onboarding', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET onboarding_completed = 1, updated_at = ? WHERE uid = ?').run(
    now,
    user.uid
  );
  const updatedUser = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as unknown as DbUserRow;
  res.json({ user: serializeUser(updatedUser) });
});

app.post(
  '/api/family/regenerate-invite',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const body = req.body as Record<string, unknown>;
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';

    if (!currentPassword || !verifySecret(currentPassword, user.password_hash)) {
      res.status(401).json({ error: 'Senha incorreta. Confirme sua identidade para prosseguir.' });
      return;
    }

    const famRow = db
      .prepare('SELECT * FROM families WHERE id = ?')
      .get(user.family_id!) as DbFamilyRow | undefined;
    if (!famRow || famRow.owner_id !== user.uid) {
      res.status(403).json({ error: 'Somente o administrador da família pode renovar o convite.' });
      return;
    }

    let newCode = generateInviteCode();
    while (db.prepare('SELECT 1 FROM families WHERE invite_code = ?').get(newCode)) {
      newCode = generateInviteCode();
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE families SET invite_code = ?, updated_at = ? WHERE id = ?').run(
      newCode,
      now,
      famRow.id
    );

    broadcastFamilySync(famRow.id, 'family');
    const { family, members } = getFamilyAndMembers(famRow.id);
    res.json({ inviteCode: newCode, family, members });
  }
);

app.delete(
  '/api/family/members/:memberUid',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const memberUid = sanitizeId(req.params.memberUid);
    const body = (req.body || {}) as Record<string, unknown>;
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';

    if (!currentPassword || !verifySecret(currentPassword, user.password_hash)) {
      res.status(401).json({ error: 'Senha incorreta. Confirme sua identidade para prosseguir.' });
      return;
    }

    if (!memberUid) {
      res.status(400).json({ error: 'Integrante inválido.' });
      return;
    }

    const famRow = db
      .prepare('SELECT * FROM families WHERE id = ?')
      .get(user.family_id!) as DbFamilyRow | undefined;
    if (!famRow || famRow.owner_id !== user.uid) {
      res.status(403).json({ error: 'Somente o administrador da família pode revogar acessos.' });
      return;
    }
    if (memberUid === famRow.owner_id) {
      res.status(400).json({ error: 'O administrador principal da família não pode ser removido.' });
      return;
    }

    const now = new Date().toISOString();
    runInTransaction(() => {
      db.prepare('DELETE FROM family_members WHERE family_id = ? AND uid = ?').run(
        famRow.id,
        memberUid
      );
      db.prepare('UPDATE users SET family_id = NULL, updated_at = ? WHERE uid = ?').run(
        now,
        memberUid
      );
    });

    broadcastFamilySync(famRow.id, 'family');
    const { family, members } = getFamilyAndMembers(famRow.id);
    res.json({ family, members });
  }
);

// --- REAL-TIME SYNC STREAM (SSE over fetch with Bearer or Cookie) ---
app.get('/api/events', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const familyId = req.authUser!.family_id!;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let set = familyStreams.get(familyId);
  if (!set) {
    set = new Set();
    familyStreams.set(familyId, set);
  }
  set.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    familyStreams.get(familyId)?.delete(res);
  });
});

// --- FINANCE ROUTES ---
app.get('/api/finance/snapshot', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const familyId = req.authUser!.family_id!;
  res.json(getFinanceSnapshot(familyId));
});

app.post('/api/finance/incomes', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const familyId = user.family_id!;
  const body = req.body as Record<string, unknown>;

  const description = clampText(body.description, MAX_LENGTHS.description);
  const amount = clampAmount(body.amount);
  const date = sanitizeDateISO(body.date);
  const category = clampText(body.category, MAX_LENGTHS.category) || 'Outros recebimentos';
  const responsibleName =
    clampText(body.responsibleName, MAX_LENGTHS.displayName) || user.display_name;
  const responsibleUid = sanitizeId(body.responsibleUid) || user.uid;
  const notes = clampText(body.notes, MAX_LENGTHS.notes);

  if (!description || amount <= 0 || !date) {
    res.status(400).json({ error: 'Preencha descrição, valor maior que zero e data válida.' });
    return;
  }

  const id = generateDocId('inc');
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `INSERT INTO incomes (
        id, family_id, description, amount, date, category, responsible_name, responsible_uid, notes,
        created_by_uid, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      familyId,
      description,
      amount,
      date,
      category,
      responsibleName,
      responsibleUid,
      notes,
      user.uid,
      user.display_name,
      now,
      now
    );

    insertAuditLog({
      familyId,
      action: 'criar',
      entityType: 'Receita',
      entityId: id,
      summary: `Registrou receita "${description}" (${formatBRLServer(amount)})`,
      amount,
      user,
    });
  });

  broadcastFamilySync(familyId, 'finance');
  res.status(201).json(getFinanceSnapshot(familyId));
});

app.put('/api/finance/incomes/:id', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const familyId = user.family_id!;
  const id = sanitizeId(req.params.id);
  const body = req.body as Record<string, unknown>;

  if (!id) {
    res.status(400).json({ error: 'Identificador inválido.' });
    return;
  }

  const description = clampText(body.description, MAX_LENGTHS.description);
  const amount = clampAmount(body.amount);
  const date = sanitizeDateISO(body.date);
  const category = clampText(body.category, MAX_LENGTHS.category) || 'Outros recebimentos';
  const responsibleName =
    clampText(body.responsibleName, MAX_LENGTHS.displayName) || user.display_name;
  const responsibleUid = sanitizeId(body.responsibleUid) || user.uid;
  const notes = clampText(body.notes, MAX_LENGTHS.notes);

  if (!description || amount <= 0 || !date) {
    res.status(400).json({ error: 'Preencha descrição, valor maior que zero e data válida.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM incomes WHERE id = ? AND family_id = ?')
    .get(id, familyId);
  if (!existing) {
    res.status(404).json({ error: 'Receita não encontrada.' });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    db.prepare(
      `UPDATE incomes
       SET description = ?, amount = ?, date = ?, category = ?, responsible_name = ?, responsible_uid = ?, notes = ?, updated_at = ?
       WHERE id = ? AND family_id = ?`
    ).run(
      description,
      amount,
      date,
      category,
      responsibleName,
      responsibleUid,
      notes,
      now,
      id,
      familyId
    );
    insertAuditLog({
      familyId,
      action: 'editar',
      entityType: 'Receita',
      entityId: id,
      summary: `Editou receita "${description}" (${formatBRLServer(amount)})`,
      amount,
      user,
    });
  });

  broadcastFamilySync(familyId, 'finance');
  res.json(getFinanceSnapshot(familyId));
});

app.delete(
  '/api/finance/incomes/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const row = db
      .prepare('SELECT id, description, amount FROM incomes WHERE id = ? AND family_id = ?')
      .get(id, familyId) as { id: string; description: string; amount: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Receita não encontrada.' });
      return;
    }

    runInTransaction(() => {
      db.prepare('DELETE FROM incomes WHERE id = ? AND family_id = ?').run(id, familyId);
      insertAuditLog({
        familyId,
        action: 'excluir',
        entityType: 'Receita',
        entityId: id,
        summary: `Excluiu receita "${row.description}" (${formatBRLServer(Number(row.amount))})`,
        amount: Number(row.amount),
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.post('/api/finance/expenses', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const familyId = user.family_id!;
  const body = req.body as Record<string, unknown>;

  const baseDesc = clampText(body.description, MAX_LENGTHS.description);
  const category = clampText(body.category, MAX_LENGTHS.category) || 'Outras Despesas';
  const subcategory = clampText(body.subcategory, MAX_LENGTHS.subcategory) || 'Outros';
  const totalAmount = clampAmount(body.amount);
  const date = sanitizeDateISO(body.date);
  const paymentMethod = clampText(body.paymentMethod, MAX_LENGTHS.paymentMethod) || 'PIX';
  const responsibleName =
    clampText(body.responsibleName, MAX_LENGTHS.displayName) || user.display_name;
  const responsibleUid = sanitizeId(body.responsibleUid) || user.uid;
  const notes = clampText(body.notes, MAX_LENGTHS.notes);
  const status = body.status === 'pendente' ? 'pendente' : 'pago';
  const isRecurring = Boolean(body.isRecurring);
  const rawInstallments = Number(body.installments || 1);
  const installments = Number.isFinite(rawInstallments)
    ? Math.max(1, Math.min(Math.round(rawInstallments), 60))
    : 1;

  if (!baseDesc || totalAmount <= 0 || !date) {
    res.status(400).json({ error: 'Preencha descrição, valor maior que zero e data válida.' });
    return;
  }

  const isInstallment = installments > 1;
  const installmentGroupId = isInstallment ? generateDocId('parc') : null;
  const perInstallment = isInstallment ? clampAmount(totalAmount / installments) : totalAmount;
  const now = new Date().toISOString();

  runInTransaction(() => {
    const stmt = db.prepare(
      `INSERT INTO expenses (
        id, family_id, description, category, subcategory, amount, date, payment_method,
        responsible_name, responsible_uid, notes, status, is_installment,
        installment_group_id, installment_number, total_installments, is_recurring,
        fixed_bill_id, reference_month, created_by_uid, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
    );

    let lastId = '';
    for (let i = 0; i < installments; i++) {
      const id = generateDocId('exp');
      lastId = id;
      const instDate = isInstallment ? addMonthsToISO(date, i) : date;
      const desc = isInstallment
        ? clampText(`${baseDesc} (${i + 1}/${installments})`, MAX_LENGTHS.description)
        : baseDesc;

      stmt.run(
        id,
        familyId,
        desc,
        category,
        subcategory,
        perInstallment,
        instDate,
        paymentMethod,
        responsibleName,
        responsibleUid,
        notes,
        i === 0 ? status : 'pendente',
        isInstallment ? 1 : 0,
        installmentGroupId,
        isInstallment ? i + 1 : null,
        isInstallment ? installments : null,
        isRecurring ? 1 : 0,
        instDate.slice(0, 7),
        user.uid,
        user.display_name,
        now,
        now
      );
    }

    insertAuditLog({
      familyId,
      action: 'criar',
      entityType: 'Despesa',
      entityId: installmentGroupId || lastId,
      summary: isInstallment
        ? `Registrou despesa parcelada "${baseDesc}" em ${installments}x (total ${formatBRLServer(totalAmount)})`
        : `Registrou despesa "${baseDesc}" (${formatBRLServer(totalAmount)})`,
      amount: totalAmount,
      user,
    });
  });

  broadcastFamilySync(familyId, 'finance');
  res.status(201).json(getFinanceSnapshot(familyId));
});

app.put(
  '/api/finance/expenses/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    const body = req.body as Record<string, unknown>;

    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const description = clampText(body.description, MAX_LENGTHS.description);
    const category = clampText(body.category, MAX_LENGTHS.category) || 'Outras Despesas';
    const subcategory = clampText(body.subcategory, MAX_LENGTHS.subcategory) || 'Outros';
    const amount = clampAmount(body.amount);
    const date = sanitizeDateISO(body.date);
    const paymentMethod = clampText(body.paymentMethod, MAX_LENGTHS.paymentMethod) || 'PIX';
    const responsibleName =
      clampText(body.responsibleName, MAX_LENGTHS.displayName) || user.display_name;
    const responsibleUid = sanitizeId(body.responsibleUid) || user.uid;
    const notes = clampText(body.notes, MAX_LENGTHS.notes);
    const status = body.status === 'pendente' ? 'pendente' : 'pago';

    if (!description || amount <= 0 || !date) {
      res.status(400).json({ error: 'Preencha descrição, valor maior que zero e data válida.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM expenses WHERE id = ? AND family_id = ?')
      .get(id, familyId);
    if (!existing) {
      res.status(404).json({ error: 'Despesa não encontrada.' });
      return;
    }

    const now = new Date().toISOString();
    runInTransaction(() => {
      db.prepare(
        `UPDATE expenses
         SET description = ?, category = ?, subcategory = ?, amount = ?, date = ?, payment_method = ?,
             responsible_name = ?, responsible_uid = ?, notes = ?, status = ?, reference_month = ?, updated_at = ?
         WHERE id = ? AND family_id = ?`
      ).run(
        description,
        category,
        subcategory,
        amount,
        date,
        paymentMethod,
        responsibleName,
        responsibleUid,
        notes,
        status,
        date.slice(0, 7),
        now,
        id,
        familyId
      );

      insertAuditLog({
        familyId,
        action: 'editar',
        entityType: 'Despesa',
        entityId: id,
        summary: `Editou despesa "${description}" (${formatBRLServer(amount)})`,
        amount,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.patch(
  '/api/finance/expenses/:id/toggle',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const row = db
      .prepare('SELECT status FROM expenses WHERE id = ? AND family_id = ?')
      .get(id, familyId) as { status: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Despesa não encontrada.' });
      return;
    }

    const nextStatus = row.status === 'pago' ? 'pendente' : 'pago';
    db.prepare('UPDATE expenses SET status = ?, updated_at = ? WHERE id = ? AND family_id = ?').run(
      nextStatus,
      new Date().toISOString(),
      id,
      familyId
    );

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.delete(
  '/api/finance/expenses/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const row = db
      .prepare('SELECT id, description, amount FROM expenses WHERE id = ? AND family_id = ?')
      .get(id, familyId) as { id: string; description: string; amount: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Despesa não encontrada.' });
      return;
    }

    runInTransaction(() => {
      db.prepare('DELETE FROM expenses WHERE id = ? AND family_id = ?').run(id, familyId);
      insertAuditLog({
        familyId,
        action: 'excluir',
        entityType: 'Despesa',
        entityId: id,
        summary: `Excluiu despesa "${row.description}" (${formatBRLServer(Number(row.amount))})`,
        amount: Number(row.amount),
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

// --- FIXED BILLS ---
app.post(
  '/api/finance/fixed-bills',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const body = req.body as Record<string, unknown>;

    const name = clampText(body.name, MAX_LENGTHS.billName);
    const expectedAmount = clampAmount(body.expectedAmount);
    const dueDay = Math.min(Math.max(Math.round(Number(body.dueDay || 10)), 1), 31);
    const frequency =
      typeof body.frequency === 'string' && VALID_FREQUENCIES.has(body.frequency)
        ? body.frequency
        : 'mensal';
    const category = clampText(body.category, MAX_LENGTHS.category) || 'Contas da Casa';
    const subcategory = clampText(body.subcategory, MAX_LENGTHS.subcategory) || 'Outras contas';
    const active = body.active !== false;
    const notes = clampText(body.notes, MAX_LENGTHS.notes);

    if (!name || expectedAmount <= 0) {
      res.status(400).json({ error: 'Informe nome e valor previsto maior que zero.' });
      return;
    }

    const id = generateDocId('bill');
    const now = new Date().toISOString();

    runInTransaction(() => {
      db.prepare(
        `INSERT INTO fixed_bills (
          id, family_id, name, expected_amount, due_day, frequency, category, subcategory,
          last_paid_month, last_paid_date, last_paid_amount, active, notes,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        familyId,
        name,
        expectedAmount,
        dueDay,
        frequency,
        category,
        subcategory,
        active ? 1 : 0,
        notes,
        user.uid,
        user.display_name,
        now,
        now
      );
      insertAuditLog({
        familyId,
        action: 'criar',
        entityType: 'Conta Fixa',
        entityId: id,
        summary: `Cadastrou conta fixa "${name}" (${formatBRLServer(expectedAmount)})`,
        amount: expectedAmount,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.status(201).json(getFinanceSnapshot(familyId));
  }
);

app.put(
  '/api/finance/fixed-bills/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    const body = req.body as Record<string, unknown>;

    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const name = clampText(body.name, MAX_LENGTHS.billName);
    const expectedAmount = clampAmount(body.expectedAmount);
    const dueDay = Math.min(Math.max(Math.round(Number(body.dueDay || 10)), 1), 31);
    const frequency =
      typeof body.frequency === 'string' && VALID_FREQUENCIES.has(body.frequency)
        ? body.frequency
        : 'mensal';
    const category = clampText(body.category, MAX_LENGTHS.category) || 'Contas da Casa';
    const subcategory = clampText(body.subcategory, MAX_LENGTHS.subcategory) || 'Outras contas';
    const active = body.active !== false;
    const notes = clampText(body.notes, MAX_LENGTHS.notes);

    if (!name || expectedAmount <= 0) {
      res.status(400).json({ error: 'Informe nome e valor previsto maior que zero.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM fixed_bills WHERE id = ? AND family_id = ?')
      .get(id, familyId);
    if (!existing) {
      res.status(404).json({ error: 'Conta fixa não encontrada.' });
      return;
    }

    const now = new Date().toISOString();
    runInTransaction(() => {
      db.prepare(
        `UPDATE fixed_bills
         SET name = ?, expected_amount = ?, due_day = ?, frequency = ?, category = ?, subcategory = ?,
             active = ?, notes = ?, updated_at = ?
         WHERE id = ? AND family_id = ?`
      ).run(
        name,
        expectedAmount,
        dueDay,
        frequency,
        category,
        subcategory,
        active ? 1 : 0,
        notes,
        now,
        id,
        familyId
      );
      insertAuditLog({
        familyId,
        action: 'editar',
        entityType: 'Conta Fixa',
        entityId: id,
        summary: `Atualizou conta fixa "${name}"`,
        amount: expectedAmount,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.post(
  '/api/finance/fixed-bills/:id/pay',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    const body = req.body as Record<string, unknown>;

    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const amount = clampAmount(body.paidAmount);
    const paidDate = sanitizeDateISO(body.paidDate);
    const paymentMethod = clampText(body.paymentMethod, MAX_LENGTHS.paymentMethod) || 'PIX';

    if (amount <= 0 || !paidDate) {
      res.status(400).json({ error: 'Informe um valor pago maior que zero e data válida.' });
      return;
    }

    const bill = db
      .prepare('SELECT * FROM fixed_bills WHERE id = ? AND family_id = ?')
      .get(id, familyId) as Record<string, unknown> | undefined;
    if (!bill) {
      res.status(404).json({ error: 'Conta fixa não encontrada.' });
      return;
    }

    const refMonth = paidDate.slice(0, 7);
    const existingExp = db
      .prepare('SELECT 1 FROM expenses WHERE family_id = ? AND fixed_bill_id = ? AND reference_month = ?')
      .get(familyId, id, refMonth);

    if (bill.last_paid_month === refMonth || existingExp) {
      res.status(409).json({
        error: `Esta conta fixa já foi confirmada como paga em ${refMonth}.`,
      });
      return;
    }

    const expId = `fix_${id}_${refMonth}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    const now = new Date().toISOString();

    runInTransaction(() => {
      db.prepare(
        `UPDATE fixed_bills
         SET last_paid_month = ?, last_paid_date = ?, last_paid_amount = ?, updated_at = ?
         WHERE id = ? AND family_id = ?`
      ).run(refMonth, paidDate, amount, now, id, familyId);

      db.prepare(
        `INSERT INTO expenses (
          id, family_id, description, category, subcategory, amount, date, payment_method,
          responsible_name, responsible_uid, notes, status, is_installment,
          installment_group_id, installment_number, total_installments, is_recurring,
          fixed_bill_id, reference_month, created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pago', 0, NULL, NULL, NULL, 1, ?, ?, ?, ?, ?, ?)`
      ).run(
        expId,
        familyId,
        clampText(`${String(bill.name)} (Conta Fixa)`, MAX_LENGTHS.description),
        clampText(bill.category, MAX_LENGTHS.category),
        clampText(bill.subcategory, MAX_LENGTHS.subcategory),
        amount,
        paidDate,
        paymentMethod,
        user.display_name,
        user.uid,
        clampText(`Pagamento confirmado da conta fixa ${String(bill.name)}`, MAX_LENGTHS.notes),
        id,
        refMonth,
        user.uid,
        user.display_name,
        now,
        now
      );

      insertAuditLog({
        familyId,
        action: 'pagamento',
        entityType: 'Conta Fixa',
        entityId: id,
        summary: `Confirmou pagamento de "${String(bill.name)}" (${formatBRLServer(amount)})`,
        amount,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.delete(
  '/api/finance/fixed-bills/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const row = db
      .prepare('SELECT id, name, expected_amount FROM fixed_bills WHERE id = ? AND family_id = ?')
      .get(id, familyId) as { id: string; name: string; expected_amount: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Conta fixa não encontrada.' });
      return;
    }

    runInTransaction(() => {
      db.prepare('DELETE FROM fixed_bills WHERE id = ? AND family_id = ?').run(id, familyId);
      insertAuditLog({
        familyId,
        action: 'excluir',
        entityType: 'Conta Fixa',
        entityId: id,
        summary: `Removeu conta fixa "${row.name}"`,
        amount: Number(row.expected_amount),
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

// --- DEBTS ---
app.post('/api/finance/debts', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const familyId = user.family_id!;
  const body = req.body as Record<string, unknown>;

  const name = clampText(body.name, MAX_LENGTHS.debtName);
  const creditor = clampText(body.creditor, MAX_LENGTHS.creditor) || 'Credor';
  const originalAmount = clampAmount(body.originalAmount);
  const currentAmount = clampAmount(body.currentAmount);
  const installmentAmount = clampAmount(body.installmentAmount);
  const totalInstallments = Math.max(
    1,
    Math.min(Math.round(Number(body.totalInstallments || 1)), 600)
  );
  const paidInstallments = Math.max(
    0,
    Math.min(Math.round(Number(body.paidInstallments || 0)), totalInstallments)
  );
  const rawInterest = Number(body.interestRate || 0);
  const interestRate = Number.isFinite(rawInterest) ? Math.max(0, Math.min(rawInterest, 1000)) : 0;
  const dueDate = sanitizeDateISO(body.dueDate);
  const notes = clampText(body.notes, MAX_LENGTHS.notes);

  if (!name || originalAmount <= 0 || !dueDate) {
    res.status(400).json({ error: 'Preencha nome, valor original maior que zero e data válida.' });
    return;
  }

  const status = currentAmount <= 0 || paidInstallments >= totalInstallments ? 'quitada' : 'ativa';
  const id = generateDocId('debt');
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `INSERT INTO debts (
        id, family_id, name, creditor, original_amount, current_amount, installment_amount,
        total_installments, paid_installments, interest_rate, due_date, status, notes,
        created_by_uid, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      familyId,
      name,
      creditor,
      originalAmount,
      currentAmount,
      installmentAmount,
      totalInstallments,
      paidInstallments,
      interestRate,
      dueDate,
      status,
      notes,
      user.uid,
      user.display_name,
      now,
      now
    );
    insertAuditLog({
      familyId,
      action: 'criar',
      entityType: 'Dívida',
      entityId: id,
      summary: `Cadastrou dívida "${name}" (${formatBRLServer(currentAmount)})`,
      amount: currentAmount,
      user,
    });
  });

  broadcastFamilySync(familyId, 'finance');
  res.status(201).json(getFinanceSnapshot(familyId));
});

app.put('/api/finance/debts/:id', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const familyId = user.family_id!;
  const id = sanitizeId(req.params.id);
  const body = req.body as Record<string, unknown>;

  if (!id) {
    res.status(400).json({ error: 'Identificador inválido.' });
    return;
  }

  const name = clampText(body.name, MAX_LENGTHS.debtName);
  const creditor = clampText(body.creditor, MAX_LENGTHS.creditor) || 'Credor';
  const originalAmount = clampAmount(body.originalAmount);
  const currentAmount = clampAmount(body.currentAmount);
  const installmentAmount = clampAmount(body.installmentAmount);
  const totalInstallments = Math.max(
    1,
    Math.min(Math.round(Number(body.totalInstallments || 1)), 600)
  );
  const paidInstallments = Math.max(
    0,
    Math.min(Math.round(Number(body.paidInstallments || 0)), totalInstallments)
  );
  const rawInterest = Number(body.interestRate || 0);
  const interestRate = Number.isFinite(rawInterest) ? Math.max(0, Math.min(rawInterest, 1000)) : 0;
  const dueDate = sanitizeDateISO(body.dueDate);
  const notes = clampText(body.notes, MAX_LENGTHS.notes);

  if (!name || originalAmount <= 0 || !dueDate) {
    res.status(400).json({ error: 'Preencha nome, valor original maior que zero e data válida.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM debts WHERE id = ? AND family_id = ?')
    .get(id, familyId);
  if (!existing) {
    res.status(404).json({ error: 'Dívida não encontrada.' });
    return;
  }

  const status = currentAmount <= 0 || paidInstallments >= totalInstallments ? 'quitada' : 'ativa';
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `UPDATE debts
       SET name = ?, creditor = ?, original_amount = ?, current_amount = ?, installment_amount = ?,
           total_installments = ?, paid_installments = ?, interest_rate = ?, due_date = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ? AND family_id = ?`
    ).run(
      name,
      creditor,
      originalAmount,
      currentAmount,
      installmentAmount,
      totalInstallments,
      paidInstallments,
      interestRate,
      dueDate,
      status,
      notes,
      now,
      id,
      familyId
    );
    insertAuditLog({
      familyId,
      action: 'editar',
      entityType: 'Dívida',
      entityId: id,
      summary: `Editou dívida "${name}"`,
      amount: currentAmount,
      user,
    });
  });

  broadcastFamilySync(familyId, 'finance');
  res.json(getFinanceSnapshot(familyId));
});

app.post(
  '/api/finance/debts/:id/pay',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    const body = req.body as Record<string, unknown>;

    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const payVal = clampAmount(body.amount);
    const date = sanitizeDateISO(body.date);
    const paymentType =
      typeof body.paymentType === 'string' && VALID_PAYMENT_TYPES.has(body.paymentType)
        ? (body.paymentType as 'parcela' | 'parcial' | 'quitacao')
        : 'parcela';
    const recordAsExpense = Boolean(body.recordAsExpense);
    const paymentMethod = clampText(body.paymentMethod, MAX_LENGTHS.paymentMethod) || 'PIX';
    const notes = clampText(body.notes, MAX_LENGTHS.notes);

    if (payVal <= 0 || !date) {
      res.status(400).json({ error: 'Informe um valor de pagamento maior que zero e data válida.' });
      return;
    }

    const debt = db
      .prepare('SELECT * FROM debts WHERE id = ? AND family_id = ?')
      .get(id, familyId) as Record<string, unknown> | undefined;
    if (!debt) {
      res.status(404).json({ error: 'Dívida não encontrada.' });
      return;
    }
    if (debt.status === 'quitada') {
      res.status(409).json({ error: 'Esta dívida já está quitada.' });
      return;
    }

    const curAmount = Number(debt.current_amount);
    const totalInst = Number(debt.total_installments);
    const paidInst = Number(debt.paid_installments);

    const newCurrentAmount =
      paymentType === 'quitacao' ? 0 : Math.max(0, clampAmount(curAmount - payVal));
    let newPaidInstallments = paidInst;
    if (paymentType === 'quitacao' || newCurrentAmount === 0) {
      newPaidInstallments = totalInst;
    } else if (paymentType === 'parcela') {
      newPaidInstallments = Math.min(totalInst, paidInst + 1);
    }
    const nextStatus = newCurrentAmount <= 0 ? 'quitada' : 'ativa';

    const paymentId = generateDocId('dpay');
    const now = new Date().toISOString();

    runInTransaction(() => {
      db.prepare(
        `INSERT INTO debt_payments (
          id, family_id, debt_id, debt_name, amount, date, payment_type, notes, created_by_uid, created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        paymentId,
        familyId,
        id,
        clampText(debt.name, MAX_LENGTHS.debtName),
        payVal,
        date,
        paymentType,
        notes,
        user.uid,
        user.display_name,
        now
      );

      db.prepare(
        'UPDATE debts SET current_amount = ?, paid_installments = ?, status = ?, updated_at = ? WHERE id = ? AND family_id = ?'
      ).run(newCurrentAmount, newPaidInstallments, nextStatus, now, id, familyId);

      if (recordAsExpense) {
        const expId = generateDocId('exp');
        db.prepare(
          `INSERT INTO expenses (
            id, family_id, description, category, subcategory, amount, date, payment_method,
            responsible_name, responsible_uid, notes, status, is_installment,
            installment_group_id, installment_number, total_installments, is_recurring,
            fixed_bill_id, reference_month, created_by_uid, created_by_name, created_at, updated_at
          ) VALUES (?, ?, ?, 'Contas da Casa', 'Financiamento', ?, ?, ?, ?, ?, ?, 'pago', 0, NULL, NULL, NULL, 0, NULL, ?, ?, ?, ?, ?)`
        ).run(
          expId,
          familyId,
          clampText(`Pagamento dívida: ${String(debt.name)}`, MAX_LENGTHS.description),
          payVal,
          date,
          paymentMethod,
          user.display_name,
          user.uid,
          clampText(notes || `Amortização registrada para ${String(debt.creditor)}`, MAX_LENGTHS.notes),
          date.slice(0, 7),
          user.uid,
          user.display_name,
          now,
          now
        );
      }

      insertAuditLog({
        familyId,
        action: 'pagamento',
        entityType: 'Dívida',
        entityId: id,
        summary:
          nextStatus === 'quitada'
            ? `Quitou a dívida "${String(debt.name)}" com pagamento de ${formatBRLServer(payVal)}`
            : `Registrou pagamento de ${formatBRLServer(payVal)} na dívida "${String(debt.name)}"`,
        amount: payVal,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.delete(
  '/api/finance/debts/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const row = db
      .prepare('SELECT id, name, current_amount FROM debts WHERE id = ? AND family_id = ?')
      .get(id, familyId) as { id: string; name: string; current_amount: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Dívida não encontrada.' });
      return;
    }

    runInTransaction(() => {
      db.prepare('DELETE FROM debts WHERE id = ? AND family_id = ?').run(id, familyId);
      insertAuditLog({
        familyId,
        action: 'excluir',
        entityType: 'Dívida',
        entityId: id,
        summary: `Excluiu dívida "${row.name}"`,
        amount: Number(row.current_amount),
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

// --- RESERVES ---
app.post(
  '/api/finance/reserves',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const body = req.body as Record<string, unknown>;

    const name = clampText(body.name, MAX_LENGTHS.goalName);
    const targetAmount = clampAmount(body.targetAmount);
    const monthlyContribution = clampAmount(body.monthlyContribution);
    const notes = clampText(body.notes, MAX_LENGTHS.notes);

    if (!name || targetAmount <= 0) {
      res.status(400).json({ error: 'Informe nome e valor da meta maior que zero.' });
      return;
    }

    const id = generateDocId('res');
    const now = new Date().toISOString();

    runInTransaction(() => {
      db.prepare(
        `INSERT INTO reserves (
          id, family_id, name, target_amount, current_amount, monthly_contribution, notes,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        familyId,
        name,
        targetAmount,
        monthlyContribution,
        notes,
        user.uid,
        user.display_name,
        now,
        now
      );

      insertAuditLog({
        familyId,
        action: 'reserva',
        entityType: 'Reserva',
        entityId: id,
        summary: `Criou meta de economia "${name}" (${formatBRLServer(targetAmount)})`,
        amount: targetAmount,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.status(201).json(getFinanceSnapshot(familyId));
  }
);

app.put(
  '/api/finance/reserves/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    const body = req.body as Record<string, unknown>;

    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const name = clampText(body.name, MAX_LENGTHS.goalName);
    const targetAmount = clampAmount(body.targetAmount);
    const monthlyContribution = clampAmount(body.monthlyContribution);
    const notes = clampText(body.notes, MAX_LENGTHS.notes);

    if (!name || targetAmount <= 0) {
      res.status(400).json({ error: 'Informe nome e valor da meta maior que zero.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM reserves WHERE id = ? AND family_id = ?')
      .get(id, familyId);
    if (!existing) {
      res.status(404).json({ error: 'Meta de reserva não encontrada.' });
      return;
    }

    const now = new Date().toISOString();
    runInTransaction(() => {
      db.prepare(
        `UPDATE reserves
         SET name = ?, target_amount = ?, monthly_contribution = ?, notes = ?, updated_at = ?
         WHERE id = ? AND family_id = ?`
      ).run(name, targetAmount, monthlyContribution, notes, now, id, familyId);
      insertAuditLog({
        familyId,
        action: 'editar',
        entityType: 'Reserva',
        entityId: id,
        summary: `Atualizou meta "${name}"`,
        amount: targetAmount,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.post(
  '/api/finance/reserves/:id/move',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    const body = req.body as Record<string, unknown>;

    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const type = body.type === 'retirada' ? 'retirada' : 'deposito';
    const val = clampAmount(body.amount);
    const date = sanitizeDateISO(body.date);
    const notes = clampText(body.notes, MAX_LENGTHS.notes);

    if (val <= 0 || !date) {
      res.status(400).json({ error: 'Informe um valor maior que zero e data válida.' });
      return;
    }

    const goal = db
      .prepare('SELECT * FROM reserves WHERE id = ? AND family_id = ?')
      .get(id, familyId) as Record<string, unknown> | undefined;
    if (!goal) {
      res.status(404).json({ error: 'Meta de reserva não encontrada.' });
      return;
    }

    const currentAmount = Number(goal.current_amount);
    if (type === 'retirada' && val > currentAmount) {
      res.status(400).json({
        error: 'O valor da retirada não pode ser maior que o saldo guardado nesta meta.',
      });
      return;
    }

    const nextAmount =
      type === 'deposito'
        ? clampAmount(currentAmount + val)
        : Math.max(0, clampAmount(currentAmount - val));

    const movId = generateDocId('rmov');
    const now = new Date().toISOString();

    runInTransaction(() => {
      db.prepare(
        `INSERT INTO reserve_movements (
          id, family_id, goal_id, goal_name, type, amount, date, notes, created_by_uid, created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        movId,
        familyId,
        id,
        clampText(goal.name, MAX_LENGTHS.goalName),
        type,
        val,
        date,
        notes,
        user.uid,
        user.display_name,
        now
      );

      db.prepare('UPDATE reserves SET current_amount = ?, updated_at = ? WHERE id = ? AND family_id = ?').run(
        nextAmount,
        now,
        id,
        familyId
      );

      insertAuditLog({
        familyId,
        action: 'reserva',
        entityType: 'Reserva',
        entityId: id,
        summary:
          type === 'deposito'
            ? `Guardou ${formatBRLServer(val)} na meta "${String(goal.name)}"`
            : `Retirou ${formatBRLServer(val)} da meta "${String(goal.name)}"`,
        amount: val,
        user,
      });
    });

    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

app.delete(
  '/api/finance/reserves/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM reserves WHERE id = ? AND family_id = ?')
      .get(id, familyId);
    if (!existing) {
      res.status(404).json({ error: 'Meta de reserva não encontrada.' });
      return;
    }

    db.prepare('DELETE FROM reserves WHERE id = ? AND family_id = ?').run(id, familyId);
    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

// --- BUDGETS ---
app.post('/api/finance/budgets', requireAuth, requireFamily, (req: AuthedRequest, res: Response) => {
  const user = req.authUser!;
  const familyId = user.family_id!;
  const body = req.body as Record<string, unknown>;

  const category = clampText(body.category, MAX_LENGTHS.category);
  const monthlyLimit = clampAmount(body.monthlyLimit);
  const existingId = sanitizeId(body.existingId);
  const now = new Date().toISOString();

  if (existingId) {
    const existing = db
      .prepare('SELECT id FROM budgets WHERE id = ? AND family_id = ?')
      .get(existingId, familyId);
    if (!existing) {
      res.status(404).json({ error: 'Orçamento não encontrado.' });
      return;
    }
    db.prepare('UPDATE budgets SET monthly_limit = ?, updated_at = ? WHERE id = ? AND family_id = ?').run(
      monthlyLimit,
      now,
      existingId,
      familyId
    );
  } else {
    if (!category) {
      res.status(400).json({ error: 'Informe a categoria do orçamento.' });
      return;
    }
    const id = generateDocId('bud');
    db.prepare(
      `INSERT INTO budgets (
        id, family_id, category, monthly_limit, month, created_by_uid, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'padrao', ?, ?, ?, ?)`
    ).run(id, familyId, category, monthlyLimit, user.uid, user.display_name, now, now);
  }

  broadcastFamilySync(familyId, 'finance');
  res.json(getFinanceSnapshot(familyId));
});

app.delete(
  '/api/finance/budgets/:id',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const id = sanitizeId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    db.prepare('DELETE FROM budgets WHERE id = ? AND family_id = ?').run(id, familyId);
    broadcastFamilySync(familyId, 'finance');
    res.json(getFinanceSnapshot(familyId));
  }
);

// --- BACKUP RESTORE ---
app.post(
  '/api/finance/restore-backup',
  requireAuth,
  requireFamily,
  (req: AuthedRequest, res: Response) => {
    const user = req.authUser!;
    const familyId = user.family_id!;
    const body = req.body as Record<string, unknown>;
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';

    if (!currentPassword || !verifySecret(currentPassword, user.password_hash)) {
      res.status(401).json({ error: 'Senha incorreta. Confirme sua identidade para prosseguir.' });
      return;
    }

    const backup = body.backup as Record<string, unknown> | undefined;
    if (!backup || backup.app !== 'Blessed Finance' || !Array.isArray(backup.incomes)) {
      res.status(400).json({ error: 'Arquivo de backup inválido ou incompatível.' });
      return;
    }

    const fallbackDate = `${getTodayBrazilISO().slice(0, 7)}-01`;
    const now = new Date().toISOString();
    let restoredCount = 0;

    runInTransaction(() => {
      const existingIncomeRows = db
        .prepare('SELECT id FROM incomes WHERE family_id = ?')
        .all(familyId) as Array<{ id: string }>;
      const existingIncomeIds = new Set(existingIncomeRows.map((r) => r.id));

      const incStmt = db.prepare(
        `INSERT INTO incomes (
          id, family_id, description, amount, date, category, responsible_name, responsible_uid, notes,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const rawIncomes = Array.isArray(backup.incomes) ? backup.incomes : [];
      for (const rawItem of rawIncomes.slice(0, 100)) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const item = rawItem as Record<string, unknown>;
        const id = sanitizeId(item.id) || generateDocId('inc');
        if (existingIncomeIds.has(id)) continue;
        const amt = clampAmount(item.amount);
        if (amt <= 0) continue;
        incStmt.run(
          id,
          familyId,
          clampText(item.description, MAX_LENGTHS.description) || 'Receita restaurada',
          amt,
          sanitizeDateISO(item.date) || fallbackDate,
          clampText(item.category, MAX_LENGTHS.category) || 'Outros recebimentos',
          clampText(item.responsibleName, MAX_LENGTHS.displayName) || user.display_name,
          user.uid,
          clampText(item.notes, MAX_LENGTHS.notes),
          user.uid,
          user.display_name,
          now,
          now
        );
        existingIncomeIds.add(id);
        restoredCount++;
      }

      const existingExpenseRows = db
        .prepare('SELECT id FROM expenses WHERE family_id = ?')
        .all(familyId) as Array<{ id: string }>;
      const existingExpenseIds = new Set(existingExpenseRows.map((r) => r.id));

      const expStmt = db.prepare(
        `INSERT INTO expenses (
          id, family_id, description, category, subcategory, amount, date, payment_method,
          responsible_name, responsible_uid, notes, status, is_installment,
          installment_group_id, installment_number, total_installments, is_recurring,
          fixed_bill_id, reference_month, created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?)`
      );

      const rawExpenses = Array.isArray(backup.expenses) ? backup.expenses : [];
      for (const rawItem of rawExpenses.slice(0, 150)) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const item = rawItem as Record<string, unknown>;
        const id = sanitizeId(item.id) || generateDocId('exp');
        if (existingExpenseIds.has(id)) continue;
        const amt = clampAmount(item.amount);
        if (amt <= 0) continue;
        const safeDate = sanitizeDateISO(item.date) || fallbackDate;
        expStmt.run(
          id,
          familyId,
          clampText(item.description, MAX_LENGTHS.description) || 'Despesa restaurada',
          clampText(item.category, MAX_LENGTHS.category) || 'Outras Despesas',
          clampText(item.subcategory, MAX_LENGTHS.subcategory) || 'Outros',
          amt,
          safeDate,
          clampText(item.paymentMethod, MAX_LENGTHS.paymentMethod) || 'PIX',
          clampText(item.responsibleName, MAX_LENGTHS.displayName) || user.display_name,
          user.uid,
          clampText(item.notes, MAX_LENGTHS.notes),
          item.status === 'pendente' ? 'pendente' : 'pago',
          item.isInstallment ? 1 : 0,
          item.isRecurring ? 1 : 0,
          safeDate.slice(0, 7),
          user.uid,
          user.display_name,
          now,
          now
        );
        existingExpenseIds.add(id);
        restoredCount++;
      }

      if (restoredCount > 0) {
        insertAuditLog({
          familyId,
          action: 'criar',
          entityType: 'Backup',
          entityId: generateDocId('bkp'),
          summary: `Restaurou ${restoredCount} registro(s) a partir de backup JSON`,
          user,
        });
      }
    });

    if (restoredCount > 0) {
      broadcastFamilySync(familyId, 'finance');
    }

    res.json({ restoredCount, snapshot: getFinanceSnapshot(familyId) });
  }
);

app.use('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Recurso não encontrado.' });
});

async function startServer() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        dotfiles: 'deny',
        etag: true,
        maxAge: '1h',
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.resolve(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Aplicação não compilada.');
      }
    });
  }

  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Blessed Finance server listening on port ${PORT} (SQLite local database)`);
  });
}

void startServer();
