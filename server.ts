import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import {
  db,
  generateId,
  generateInviteCode,
  generateSessionToken,
  generateSixDigitCode,
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
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_VERIFY_ATTEMPTS = 5;

type Row = Record<string, unknown>;

interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  role: 'marido' | 'esposa' | 'familiar';
  familyId: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RequestWithUser extends Request {
  authUser?: AuthUser;
  authTokenHash?: string;
}

// --- Helpers & Sanitizers ---

function clampText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function clampEmail(val: unknown): string {
  if (typeof val !== 'string') return '';
  return val.trim().toLowerCase().slice(0, 150);
}

function clampAmount(val: unknown): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(Math.round(num * 100) / 100, 100_000_000);
}

function normalizeRole(val: unknown): 'marido' | 'esposa' | 'familiar' {
  return val === 'marido' || val === 'esposa' || val === 'familiar' ? val : 'familiar';
}

function normalizeFrequency(val: unknown): 'mensal' | 'bimestral' | 'trimestral' | 'anual' {
  return val === 'mensal' || val === 'bimestral' || val === 'trimestral' || val === 'anual'
    ? val
    : 'mensal';
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

function normalizeIsoDate(val: unknown, fallback: string): string {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

function addMonthsToISO(isoDate: string, monthsToAdd: number): string {
  const [yStr, mStr, dStr] = isoDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const targetIdx = month + monthsToAdd;
  const targetYear = year + Math.floor(targetIdx / 12);
  const normMonth = ((targetIdx % 12) + 12) % 12;
  const maxDay = new Date(targetYear, normMonth + 1, 0).getDate();
  const safeDay = Math.min(day, maxDay);
  return `${targetYear}-${String(normMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  return req.secure || (typeof proto === 'string' && proto.split(',')[0].trim() === 'https');
}

function setSessionCookie(req: Request, res: Response, token: string) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const https = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
    https ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response) {
  const https = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    https ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function mapUserRow(row: Row): AuthUser {
  return {
    uid: String(row.uid),
    displayName: String(row.display_name),
    email: String(row.email),
    role: normalizeRole(row.role),
    familyId: row.family_id ? String(row.family_id) : null,
    onboardingCompleted: Number(row.onboarding_completed) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function getFamilyBundle(user: AuthUser) {
  if (!user.familyId) {
    return { user, family: null, members: [] };
  }
  const memberCheck = db
    .prepare('SELECT 1 AS ok FROM family_members WHERE family_id = ? AND uid = ?')
    .get(user.familyId, user.uid);
  if (!memberCheck) {
    return { user: { ...user, familyId: null }, family: null, members: [] };
  }
  const fam = db.prepare('SELECT * FROM families WHERE id = ?').get(user.familyId) as
    | Row
    | undefined;
  if (!fam) {
    return { user: { ...user, familyId: null }, family: null, members: [] };
  }

  const family = {
    id: String(fam.id),
    name: String(fam.name),
    ownerId: String(fam.owner_id),
    inviteCode: String(fam.invite_code),
    createdAt: String(fam.created_at),
    updatedAt: String(fam.updated_at),
  };

  const memberRows = db
    .prepare(
      'SELECT uid, display_name, role, joined_at FROM family_members WHERE family_id = ? ORDER BY joined_at ASC'
    )
    .all(family.id) as Row[];

  const members = memberRows.map((m) => ({
    uid: String(m.uid),
    displayName: String(m.display_name),
    role: normalizeRole(m.role),
    inviteCode: family.inviteCode,
    joinedAt: String(m.joined_at),
  }));

  return { user, family, members };
}

function createSessionForUser(uid: string): string {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  db.prepare(
    'INSERT INTO sessions (token_hash, uid, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(tokenHash, uid, expiresAt, now.toISOString());

  return token;
}

function extractRequestToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

function resolveSession(req: Request): { user: AuthUser; tokenHash: string } | null {
  const token = extractRequestToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const sess = db
    .prepare('SELECT uid, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as Row | undefined;
  if (!sess) return null;
  if (new Date(String(sess.expires_at)).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const userRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(String(sess.uid)) as
    | Row
    | undefined;
  if (!userRow) return null;
  return { user: mapUserRow(userRow), tokenHash };
}

function requireAuth(req: RequestWithUser, res: Response, next: NextFunction) {
  const resolved = resolveSession(req);
  if (!resolved) {
    res.status(401).json({ error: 'Sessão expirada ou não autenticada.' });
    return;
  }
  req.authUser = resolved.user;
  req.authTokenHash = resolved.tokenHash;
  next();
}

function requireFamily(req: RequestWithUser, res: Response): { user: AuthUser; familyId: string } | null {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: 'Sessão inválida.' });
    return null;
  }
  if (!user.familyId) {
    res.status(400).json({ error: 'Crie ou entre em uma família antes de registrar lançamentos.' });
    return null;
  }
  const member = db
    .prepare('SELECT 1 AS ok FROM family_members WHERE family_id = ? AND uid = ?')
    .get(user.familyId, user.uid);
  if (!member) {
    res.status(403).json({ error: 'Acesso negado aos dados desta família.' });
    return null;
  }
  return { user, familyId: user.familyId };
}

// --- SSE Real-Time Sync Between Family Devices ---

const sseClients = new Map<string, Set<Response>>();

function broadcastFamilySync(familyId: string, scope: 'finance' | 'family') {
  const set = sseClients.get(familyId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: 'sync', scope })}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // client disconnected
    }
  }
}

function insertAuditLog(params: {
  familyId: string;
  action: 'criar' | 'editar' | 'excluir' | 'pagamento' | 'reserva';
  entityType: string;
  entityId: string;
  summary: string;
  amount?: number;
  user: AuthUser;
}) {
  db.prepare(
    `INSERT INTO audit_logs (
      id, family_id, action, entity_type, entity_id, summary, amount, performed_by_uid, performed_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateId('log'),
    params.familyId,
    params.action,
    params.entityType,
    params.entityId,
    clampText(params.summary, 240),
    params.amount !== undefined ? clampAmount(params.amount) : null,
    params.user.uid,
    params.user.displayName,
    new Date().toISOString()
  );
}

function getFamilySnapshot(familyId: string) {
  const incomes = (
    db
      .prepare('SELECT * FROM incomes WHERE family_id = ? ORDER BY date DESC, created_at DESC')
      .all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    description: String(r.description),
    amount: Number(r.amount),
    date: String(r.date),
    category: String(r.category),
    responsibleName: String(r.responsible_name),
    responsibleUid: r.responsible_uid ? String(r.responsible_uid) : undefined,
    notes: r.notes ? String(r.notes) : '',
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const expenses = (
    db
      .prepare('SELECT * FROM expenses WHERE family_id = ? ORDER BY date DESC, created_at DESC')
      .all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    description: String(r.description),
    category: String(r.category),
    subcategory: String(r.subcategory),
    amount: Number(r.amount),
    date: String(r.date),
    paymentMethod: String(r.payment_method),
    responsibleName: String(r.responsible_name),
    responsibleUid: r.responsible_uid ? String(r.responsible_uid) : undefined,
    notes: r.notes ? String(r.notes) : '',
    status: r.status === 'pendente' ? 'pendente' : 'pago',
    isInstallment: Number(r.is_installment) === 1,
    installmentGroupId: r.installment_group_id ? String(r.installment_group_id) : undefined,
    installmentNumber: r.installment_number != null ? Number(r.installment_number) : undefined,
    totalInstallments: r.total_installments != null ? Number(r.total_installments) : undefined,
    isRecurring: Number(r.is_recurring) === 1,
    fixedBillId: r.fixed_bill_id ? String(r.fixed_bill_id) : undefined,
    referenceMonth: r.reference_month ? String(r.reference_month) : undefined,
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const fixedBills = (
    db.prepare('SELECT * FROM fixed_bills WHERE family_id = ? ORDER BY due_day ASC').all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    expectedAmount: Number(r.expected_amount),
    dueDay: Number(r.due_day),
    frequency: normalizeFrequency(r.frequency),
    category: String(r.category),
    subcategory: String(r.subcategory),
    lastPaidMonth: String(r.last_paid_month || ''),
    lastPaidDate: String(r.last_paid_date || ''),
    lastPaidAmount: Number(r.last_paid_amount || 0),
    active: Number(r.active) === 1,
    notes: r.notes ? String(r.notes) : '',
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const debts = (
    db.prepare('SELECT * FROM debts WHERE family_id = ? ORDER BY created_at DESC').all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    creditor: String(r.creditor),
    originalAmount: Number(r.original_amount),
    currentAmount: Number(r.current_amount),
    installmentAmount: Number(r.installment_amount),
    totalInstallments: Number(r.total_installments),
    paidInstallments: Number(r.paid_installments),
    interestRate: Number(r.interest_rate || 0),
    dueDate: String(r.due_date),
    status: r.status === 'quitada' ? 'quitada' : 'ativa',
    notes: r.notes ? String(r.notes) : '',
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const debtPayments = (
    db
      .prepare('SELECT * FROM debt_payments WHERE family_id = ? ORDER BY date DESC, created_at DESC')
      .all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    debtId: String(r.debt_id),
    debtName: String(r.debt_name),
    amount: Number(r.amount),
    date: String(r.date),
    paymentType:
      r.payment_type === 'parcial' || r.payment_type === 'quitacao' ? r.payment_type : 'parcela',
    notes: r.notes ? String(r.notes) : '',
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
  }));

  const reserves = (
    db.prepare('SELECT * FROM reserves WHERE family_id = ? ORDER BY created_at DESC').all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    targetAmount: Number(r.target_amount),
    currentAmount: Number(r.current_amount),
    monthlyContribution: Number(r.monthly_contribution),
    notes: r.notes ? String(r.notes) : '',
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const reserveMovements = (
    db
      .prepare('SELECT * FROM reserve_movements WHERE family_id = ? ORDER BY date DESC, created_at DESC')
      .all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    goalId: String(r.goal_id),
    goalName: String(r.goal_name),
    type: r.type === 'retirada' ? 'retirada' : 'deposito',
    amount: Number(r.amount),
    date: String(r.date),
    notes: r.notes ? String(r.notes) : '',
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
  }));

  const budgets = (
    db.prepare('SELECT * FROM budgets WHERE family_id = ? ORDER BY category ASC').all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    category: String(r.category),
    monthlyLimit: Number(r.monthly_limit),
    month: String(r.month),
    createdByUid: String(r.created_by_uid),
    createdByName: String(r.created_by_name),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const auditLogs = (
    db
      .prepare('SELECT * FROM audit_logs WHERE family_id = ? ORDER BY created_at DESC LIMIT 200')
      .all(familyId) as Row[]
  ).map((r) => ({
    id: String(r.id),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    summary: String(r.summary),
    amount: r.amount != null ? Number(r.amount) : undefined,
    performedByUid: String(r.performed_by_uid),
    performedByName: String(r.performed_by_name),
    createdAt: String(r.created_at),
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

// --- Email Recovery Dispatcher ---

async function sendRecoveryCodeEmail(toEmail: string, code: string): Promise<void> {
  const fromAddress = (process.env.EMAIL_FROM || process.env.SMTP_USER || '').trim();
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const smtpHost = (process.env.SMTP_HOST || '').trim();

  const subject = 'Blessed Finance — Código de recuperação de senha';
  const textBody = [
    'Olá!',
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta no Blessed Finance.',
    `Seu código de verificação de 6 dígitos é: ${code}`,
    '',
    'Este código expira em 10 minutos e só pode ser utilizado uma única vez.',
    'Se você não solicitou esta alteração, ignore este e-mail.',
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <h2 style="margin: 0 0 12px; color: #0D3B2E;">Blessed Finance</h2>
      <p style="color: #334155; font-size: 14px; line-height: 1.5;">
        Recebemos uma solicitação para redefinir a senha da sua conta familiar.
      </p>
      <div style="margin: 20px 0; padding: 16px; background: #F8FAF9; border: 1px solid #cbd5e1; border-radius: 8px; text-align: center;">
        <span style="font-size: 12px; color: #64748b; display: block; margin-bottom: 6px;">Seu código de verificação</span>
        <strong style="font-size: 28px; letter-spacing: 6px; color: #0D3B2E; font-family: monospace;">${code}</strong>
      </div>
      <p style="color: #475569; font-size: 12px; line-height: 1.5;">
        Este código é válido por <strong>10 minutos</strong> e pode ser usado apenas <strong>uma vez</strong>.
      </p>
    </div>
  `;

  if (resendKey) {
    const sender = fromAddress || 'Blessed Finance <onboarding@resend.dev>';
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender,
        to: [toEmail],
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });
    if (!resp.ok) {
      throw new Error('Falha ao enviar o e-mail de recuperação pelo provedor.');
    }
    return;
  }

  if (smtpHost) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number.isFinite(port) ? port : 587,
      secure,
      auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
      tls:
        smtpHost === '127.0.0.1' || smtpHost === 'localhost'
          ? { rejectUnauthorized: false }
          : undefined,
    });

    await transporter.sendMail({
      from: fromAddress || smtpUser || 'no-reply@blessedfinance.local',
      to: toEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return;
  }

  throw Object.assign(
    new Error(
      'Serviço de envio de e-mail não configurado no servidor. Configure SMTP_HOST/SMTP_USER/SMTP_PASS ou RESEND_API_KEY nas variáveis de ambiente.'
    ),
    { statusCode: 503 }
  );
}

// --- Express App Setup ---

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

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

app.use((_req: Request, res: Response, next: NextFunction) => {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
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

const authBuckets = new Map<string, { count: number; resetAt: number }>();
const recoveryBuckets = new Map<string, { count: number; resetAt: number }>();

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
        error: 'Muitas tentativas em sequência. Aguarde alguns minutos e tente novamente.',
      });
      return;
    }
    next();
  };
}

const authLimiter = createRateLimiter(authBuckets, 15 * 60_000, 30);
const recoveryLimiter = createRateLimiter(recoveryBuckets, 15 * 60_000, 12);

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authBuckets.entries()) {
    if (now > v.resetAt) authBuckets.delete(k);
  }
  for (const [k, v] of recoveryBuckets.entries()) {
    if (now > v.resetAt) recoveryBuckets.delete(k);
  }
}, 5 * 60_000).unref();

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
  next();
}

app.use('/api', verifyRequestOrigin);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'Blessed Finance',
    storage: 'builtin-sqlite',
  });
});

// --- Auth Routes ---

app.get('/api/auth/me', (req: Request, res: Response) => {
  const resolved = resolveSession(req);
  if (!resolved) {
    res.json({ user: null, family: null, members: [] });
    return;
  }
  res.json(getFamilyBundle(resolved.user));
});

app.post('/api/auth/register', authLimiter, (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 80);
  const email = clampEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = normalizeRole(body.role);

  if (!name || name.length < 2) {
    res.status(400).json({ error: 'Informe seu nome completo para criar a conta.' });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    return;
  }

  const existing = db.prepare('SELECT uid FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail.' });
    return;
  }

  const uid = generateId('usr');
  const now = new Date().toISOString();
  const passwordHash = hashSecret(password);

  runInTransaction(() => {
    db.prepare(
      `INSERT INTO users (uid, display_name, email, password_hash, role, family_id, onboarding_completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)`
    ).run(uid, name, email, passwordHash, role, now, now);
  });

  const token = createSessionForUser(uid);
  setSessionCookie(req, res, token);

  const userRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as Row;
  const bundle = getFamilyBundle(mapUserRow(userRow));
  res.status(201).json({ ...bundle, token });
});

app.post('/api/auth/login', authLimiter, (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const email = clampEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Informe seu e-mail e sua senha.' });
    return;
  }

  const row = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email) as (Row & { password_hash: string }) | undefined;

  if (!row || !verifySecret(password, String(row.password_hash))) {
    res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    return;
  }

  const token = createSessionForUser(String(row.uid));
  setSessionCookie(req, res, token);

  const bundle = getFamilyBundle(mapUserRow(row));
  res.json({ ...bundle, token });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = extractRequestToken(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/auth/reauthenticate', requireAuth, (req: RequestWithUser, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const row = db
    .prepare('SELECT password_hash FROM users WHERE uid = ?')
    .get(req.authUser!.uid) as Row | undefined;
  if (!row || !verifySecret(currentPassword, String(row.password_hash))) {
    res.status(401).json({ error: 'Senha atual incorreta.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, (req: RequestWithUser, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'A nova senha deve ter no mínimo 8 caracteres.' });
    return;
  }

  const row = db
    .prepare('SELECT password_hash FROM users WHERE uid = ?')
    .get(req.authUser!.uid) as Row | undefined;
  if (!row || !verifySecret(currentPassword, String(row.password_hash))) {
    res.status(401).json({ error: 'Senha atual incorreta.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?').run(
    hashSecret(newPassword),
    now,
    req.authUser!.uid
  );
  // Rotate sessions except a newly issued one
  db.prepare('DELETE FROM sessions WHERE uid = ?').run(req.authUser!.uid);
  const newToken = createSessionForUser(req.authUser!.uid);
  setSessionCookie(req, res, newToken);
  res.json({ ok: true, token: newToken });
});

// --- Email Password Recovery Routes ---

app.post('/api/recovery/request-code', recoveryLimiter, async (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const email = clampEmail(body.email);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
    return;
  }

  const user = db.prepare('SELECT uid FROM users WHERE email = ?').get(email);
  if (!user) {
    res.status(404).json({ error: 'Nenhuma conta cadastrada com este e-mail.' });
    return;
  }

  const code = generateSixDigitCode();
  const codeHash = hashSecret(code);
  const id = generateId('rec');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  runInTransaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE expires_at <= ?').run(now.toISOString());
    db.prepare('UPDATE recovery_codes SET used = 1 WHERE email = ? AND used = 0').run(email);
    db.prepare(
      `INSERT INTO recovery_codes (id, email, code_hash, expires_at, used, attempts, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?)`
    ).run(id, email, codeHash, expiresAt, now.toISOString());
  });

  try {
    await sendRecoveryCodeEmail(email, code);
    res.json({
      ok: true,
      expiresInMinutes: 10,
      message: 'Código de 6 dígitos enviado para o e-mail informado.',
    });
  } catch (err) {
    db.prepare('DELETE FROM recovery_codes WHERE id = ?').run(id);
    const statusCode =
      typeof (err as { statusCode?: unknown })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    const message =
      err instanceof Error && statusCode === 503
        ? err.message
        : 'Não foi possível enviar o e-mail de verificação. Tente novamente em instantes.';
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/recovery/verify-code', recoveryLimiter, (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const email = clampEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';

  if (!email || code.length !== 6) {
    res.status(400).json({ error: 'Informe o e-mail e o código de 6 dígitos.' });
    return;
  }

  const row = db
    .prepare(
      `SELECT id, email, code_hash, expires_at, used, attempts, created_at
       FROM recovery_codes
       WHERE email = ? AND used = 0
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(email) as
    | { id: string; code_hash: string; expires_at: string; attempts: number }
    | undefined;

  if (!row) {
    res.status(400).json({ error: 'Código inválido ou já utilizado. Solicite um novo código.' });
    return;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('UPDATE recovery_codes SET used = 1 WHERE id = ?').run(row.id);
    res.status(400).json({ error: 'Este código expirou após 10 minutos. Solicite um novo código.' });
    return;
  }

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    db.prepare('UPDATE recovery_codes SET used = 1 WHERE id = ?').run(row.id);
    res.status(429).json({ error: 'Número máximo de tentativas excedido. Solicite um novo código.' });
    return;
  }

  if (!verifySecret(code, row.code_hash)) {
    const nextAttempts = row.attempts + 1;
    db.prepare('UPDATE recovery_codes SET attempts = ?, used = ? WHERE id = ?').run(
      nextAttempts,
      nextAttempts >= MAX_VERIFY_ATTEMPTS ? 1 : 0,
      row.id
    );
    res.status(400).json({ error: 'Código incorreto. Verifique os 6 dígitos enviados.' });
    return;
  }

  const resetToken = generateSessionToken();
  const now = new Date();
  const resetExpires = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  runInTransaction(() => {
    db.prepare('UPDATE recovery_codes SET used = 1 WHERE id = ?').run(row.id);
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE email = ? AND used = 0').run(email);
    db.prepare(
      'INSERT INTO password_reset_tokens (token_hash, email, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)'
    ).run(hashToken(resetToken), email, resetExpires, now.toISOString());
  });

  res.json({ ok: true, email, resetToken });
});

app.post('/api/recovery/reset-password', recoveryLimiter, (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const email = clampEmail(body.email);
  const resetToken = typeof body.resetToken === 'string' ? body.resetToken.trim() : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!email || !resetToken || newPassword.length < 6) {
    res.status(400).json({ error: 'Dados inválidos para redefinição de senha.' });
    return;
  }

  const tokenRow = db
    .prepare(
      'SELECT token_hash, email, expires_at, used FROM password_reset_tokens WHERE token_hash = ? AND email = ? AND used = 0'
    )
    .get(hashToken(resetToken), email) as
    | { token_hash: string; expires_at: string }
    | undefined;

  if (!tokenRow || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    res.status(400).json({ error: 'Autorização expirada ou inválida. Solicite um novo código.' });
    return;
  }

  const userRow = db.prepare('SELECT uid FROM users WHERE email = ?').get(email) as
    | { uid: string }
    | undefined;
  if (!userRow) {
    res.status(404).json({ error: 'Conta não encontrada.' });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token_hash = ?').run(
      tokenRow.token_hash
    );
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?').run(
      hashSecret(newPassword),
      now,
      userRow.uid
    );
    db.prepare('DELETE FROM sessions WHERE uid = ?').run(userRow.uid);
  });

  res.json({ ok: true });
});

// --- Family Routes ---

app.post('/api/family/create', requireAuth, (req: RequestWithUser, res: Response) => {
  const user = req.authUser!;
  if (user.familyId) {
    res.status(400).json({ error: 'Esta conta já participa de uma família.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const familyName = clampText(body.familyName, 80);
  const displayName = clampText(body.displayName || user.displayName, 80);
  const role = normalizeRole(body.role || user.role);

  if (!familyName || !displayName) {
    res.status(400).json({ error: 'Preencha o nome da família e o seu nome.' });
    return;
  }

  const familyId = generateId('fam');
  let inviteCode = generateInviteCode();
  while (db.prepare('SELECT id FROM families WHERE invite_code = ?').get(inviteCode)) {
    inviteCode = generateInviteCode();
  }
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(familyId, familyName, user.uid, inviteCode, now, now);
    db.prepare(
      'INSERT INTO family_members (family_id, uid, display_name, role, joined_at) VALUES (?, ?, ?, ?, ?)'
    ).run(familyId, user.uid, displayName, role, now);
    db.prepare(
      'UPDATE users SET family_id = ?, display_name = ?, role = ?, updated_at = ? WHERE uid = ?'
    ).run(familyId, displayName, role, now, user.uid);
  });

  const updated = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as Row;
  res.json(getFamilyBundle(mapUserRow(updated)));
});

app.post('/api/family/join', requireAuth, (req: RequestWithUser, res: Response) => {
  const user = req.authUser!;
  if (user.familyId) {
    res.status(400).json({ error: 'Esta conta já participa de uma família.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const code = clampText(body.inviteCode, 16)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const displayName = clampText(body.displayName || user.displayName, 80);
  const role = normalizeRole(body.role || user.role);

  if (!code || !displayName) {
    res.status(400).json({ error: 'Informe o código de convite e o seu nome.' });
    return;
  }

  const fam = db.prepare('SELECT id FROM families WHERE invite_code = ?').get(code) as
    | { id: string }
    | undefined;
  if (!fam) {
    res.status(404).json({ error: 'Código de convite não encontrado.' });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    db.prepare(
      'INSERT OR REPLACE INTO family_members (family_id, uid, display_name, role, joined_at) VALUES (?, ?, ?, ?, ?)'
    ).run(fam.id, user.uid, displayName, role, now);
    db.prepare(
      'UPDATE users SET family_id = ?, display_name = ?, role = ?, onboarding_completed = 1, updated_at = ? WHERE uid = ?'
    ).run(fam.id, displayName, role, now, user.uid);
  });

  broadcastFamilySync(fam.id, 'family');
  const updated = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as Row;
  res.json(getFamilyBundle(mapUserRow(updated)));
});

app.patch('/api/family/profile', requireAuth, (req: RequestWithUser, res: Response) => {
  const user = req.authUser!;
  const body = (req.body || {}) as Record<string, unknown>;
  const displayName = clampText(body.displayName, 80);
  const role = normalizeRole(body.role);

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
    db.prepare('UPDATE family_members SET display_name = ?, role = ? WHERE uid = ?').run(
      displayName,
      role,
      user.uid
    );
  });

  if (user.familyId) broadcastFamilySync(user.familyId, 'family');
  const updated = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as Row;
  res.json(getFamilyBundle(mapUserRow(updated)));
});

app.patch('/api/family/name', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 80);
  if (!name) {
    res.status(400).json({ error: 'Informe o nome da família.' });
    return;
  }

  db.prepare('UPDATE families SET name = ?, updated_at = ? WHERE id = ?').run(
    name,
    new Date().toISOString(),
    ctx.familyId
  );

  broadcastFamilySync(ctx.familyId, 'family');
  const bundle = getFamilyBundle(ctx.user);
  res.json({ family: bundle.family, members: bundle.members });
});

app.post('/api/family/regenerate-invite', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const userRow = db
    .prepare('SELECT password_hash FROM users WHERE uid = ?')
    .get(ctx.user.uid) as Row | undefined;
  if (!userRow || !verifySecret(currentPassword, String(userRow.password_hash))) {
    res.status(401).json({ error: 'Senha atual incorreta.' });
    return;
  }

  const fam = db.prepare('SELECT owner_id FROM families WHERE id = ?').get(ctx.familyId) as Row;
  if (String(fam.owner_id) !== ctx.user.uid) {
    res.status(403).json({ error: 'Apenas o administrador pode renovar o código.' });
    return;
  }

  let nextCode = generateInviteCode();
  while (db.prepare('SELECT id FROM families WHERE invite_code = ?').get(nextCode)) {
    nextCode = generateInviteCode();
  }

  db.prepare('UPDATE families SET invite_code = ?, updated_at = ? WHERE id = ?').run(
    nextCode,
    new Date().toISOString(),
    ctx.familyId
  );

  broadcastFamilySync(ctx.familyId, 'family');
  const bundle = getFamilyBundle(ctx.user);
  res.json({ inviteCode: nextCode, family: bundle.family, members: bundle.members });
});

app.delete('/api/family/members/:memberUid', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  const memberUid = String(req.params.memberUid || '');
  const body = (req.body || {}) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const userRow = db
    .prepare('SELECT password_hash FROM users WHERE uid = ?')
    .get(ctx.user.uid) as Row | undefined;
  if (!userRow || !verifySecret(currentPassword, String(userRow.password_hash))) {
    res.status(401).json({ error: 'Senha atual incorreta.' });
    return;
  }

  const fam = db.prepare('SELECT owner_id FROM families WHERE id = ?').get(ctx.familyId) as Row;
  if (String(fam.owner_id) !== ctx.user.uid) {
    res.status(403).json({ error: 'Apenas o administrador pode remover integrantes.' });
    return;
  }
  if (memberUid === ctx.user.uid) {
    res.status(400).json({ error: 'Você não pode remover a própria conta.' });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    db.prepare('DELETE FROM family_members WHERE family_id = ? AND uid = ?').run(
      ctx.familyId,
      memberUid
    );
    db.prepare(
      'UPDATE users SET family_id = NULL, updated_at = ? WHERE uid = ? AND family_id = ?'
    ).run(now, memberUid, ctx.familyId);
  });

  broadcastFamilySync(ctx.familyId, 'family');
  const bundle = getFamilyBundle(ctx.user);
  res.json({ family: bundle.family, members: bundle.members });
});

app.post('/api/family/complete-onboarding', requireAuth, (req: RequestWithUser, res: Response) => {
  const user = req.authUser!;
  db.prepare('UPDATE users SET onboarding_completed = 1, updated_at = ? WHERE uid = ?').run(
    new Date().toISOString(),
    user.uid
  );
  const updated = db.prepare('SELECT * FROM users WHERE uid = ?').get(user.uid) as Row;
  res.json({ user: mapUserRow(updated) });
});

// --- SSE Events Endpoint ---

app.get('/api/events', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let set = sseClients.get(ctx.familyId);
  if (!set) {
    set = new Set();
    sseClients.set(ctx.familyId, set);
  }
  set.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // ignore
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    set?.delete(res);
  });
});

// --- Finance API Routes ---

app.get('/api/finance/snapshot', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/incomes', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const description = clampText(body.description, 140);
  const amount = clampAmount(body.amount);
  const date = normalizeIsoDate(body.date, getTodayBrazilISO());
  const category = clampText(body.category || 'Outros recebimentos', 60);
  const responsibleName = clampText(body.responsibleName || ctx.user.displayName, 80);
  const notes = clampText(body.notes, 500);

  if (!description || amount <= 0) {
    res.status(400).json({ error: 'Informe descrição e valor positivo para a receita.' });
    return;
  }

  const id = generateId('inc');
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `INSERT INTO incomes (
        id, family_id, description, amount, date, category, responsible_name, responsible_uid, notes,
        created_by_uid, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      ctx.familyId,
      description,
      amount,
      date,
      category,
      responsibleName,
      ctx.user.uid,
      notes,
      ctx.user.uid,
      ctx.user.displayName,
      now,
      now
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'criar',
      entityType: 'receita',
      entityId: id,
      summary: `Receita adicionada: ${description}`,
      amount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.put('/api/finance/incomes/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const existing = db
    .prepare('SELECT id FROM incomes WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId);
  if (!existing) {
    res.status(404).json({ error: 'Receita não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const description = clampText(body.description, 140);
  const amount = clampAmount(body.amount);
  const date = normalizeIsoDate(body.date, getTodayBrazilISO());
  const category = clampText(body.category || 'Outros recebimentos', 60);
  const responsibleName = clampText(body.responsibleName || ctx.user.displayName, 80);
  const notes = clampText(body.notes, 500);

  if (!description || amount <= 0) {
    res.status(400).json({ error: 'Informe descrição e valor positivo para a receita.' });
    return;
  }

  runInTransaction(() => {
    db.prepare(
      `UPDATE incomes SET description = ?, amount = ?, date = ?, category = ?, responsible_name = ?, notes = ?, updated_at = ?
       WHERE id = ? AND family_id = ?`
    ).run(
      description,
      amount,
      date,
      category,
      responsibleName,
      notes,
      new Date().toISOString(),
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'editar',
      entityType: 'receita',
      entityId: id,
      summary: `Receita atualizada: ${description}`,
      amount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.delete('/api/finance/incomes/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const row = db
    .prepare('SELECT description, amount FROM incomes WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId) as Row | undefined;
  if (!row) {
    res.status(404).json({ error: 'Receita não encontrada.' });
    return;
  }

  runInTransaction(() => {
    db.prepare('DELETE FROM incomes WHERE id = ? AND family_id = ?').run(id, ctx.familyId);
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'excluir',
      entityType: 'receita',
      entityId: id,
      summary: `Receita excluída: ${String(row.description)}`,
      amount: Number(row.amount),
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/expenses', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const description = clampText(body.description, 140);
  const category = clampText(body.category || 'Outras Despesas', 60);
  const subcategory = clampText(body.subcategory || 'Outros', 60);
  const amount = clampAmount(body.amount);
  const date = normalizeIsoDate(body.date, getTodayBrazilISO());
  const paymentMethod = clampText(body.paymentMethod || 'PIX', 40);
  const responsibleName = clampText(body.responsibleName || ctx.user.displayName, 80);
  const notes = clampText(body.notes, 500);
  const baseStatus = body.status === 'pendente' ? 'pendente' : 'pago';
  const totalInstallments = Math.max(1, Math.min(60, Math.round(Number(body.installments) || 1)));
  const isInstallment = totalInstallments > 1;
  const isRecurring = Boolean(body.isRecurring);

  if (!description || amount <= 0) {
    res.status(400).json({ error: 'Informe descrição e valor positivo para a despesa.' });
    return;
  }

  const groupId = isInstallment ? generateId('grp') : null;
  const now = new Date().toISOString();

  runInTransaction(() => {
    for (let i = 0; i < totalInstallments; i++) {
      const itemDate = i === 0 ? date : addMonthsToISO(date, i);
      const itemStatus = i === 0 ? baseStatus : 'pendente';
      const itemDesc = isInstallment ? `${description} (${i + 1}/${totalInstallments})` : description;
      db.prepare(
        `INSERT INTO expenses (
          id, family_id, description, category, subcategory, amount, date, payment_method,
          responsible_name, responsible_uid, notes, status, is_installment, installment_group_id,
          installment_number, total_installments, is_recurring, reference_month,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId('exp'),
        ctx.familyId,
        clampText(itemDesc, 140),
        category,
        subcategory,
        amount,
        itemDate,
        paymentMethod,
        responsibleName,
        ctx.user.uid,
        notes,
        itemStatus,
        isInstallment ? 1 : 0,
        groupId,
        isInstallment ? i + 1 : null,
        isInstallment ? totalInstallments : null,
        isRecurring ? 1 : 0,
        itemDate.slice(0, 7),
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
    }
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'criar',
      entityType: 'despesa',
      entityId: groupId || description,
      summary: isInstallment
        ? `Despesa parcelada (${totalInstallments}x): ${description}`
        : `Despesa adicionada: ${description}`,
      amount: isInstallment ? amount * totalInstallments : amount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.put('/api/finance/expenses/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const existing = db
    .prepare('SELECT id FROM expenses WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId);
  if (!existing) {
    res.status(404).json({ error: 'Despesa não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const description = clampText(body.description, 140);
  const category = clampText(body.category || 'Outras Despesas', 60);
  const subcategory = clampText(body.subcategory || 'Outros', 60);
  const amount = clampAmount(body.amount);
  const date = normalizeIsoDate(body.date, getTodayBrazilISO());
  const paymentMethod = clampText(body.paymentMethod || 'PIX', 40);
  const responsibleName = clampText(body.responsibleName || ctx.user.displayName, 80);
  const notes = clampText(body.notes, 500);
  const status = body.status === 'pendente' ? 'pendente' : 'pago';

  if (!description || amount <= 0) {
    res.status(400).json({ error: 'Informe descrição e valor positivo para a despesa.' });
    return;
  }

  runInTransaction(() => {
    db.prepare(
      `UPDATE expenses SET
        description = ?, category = ?, subcategory = ?, amount = ?, date = ?,
        payment_method = ?, responsible_name = ?, notes = ?, status = ?, reference_month = ?, updated_at = ?
       WHERE id = ? AND family_id = ?`
    ).run(
      description,
      category,
      subcategory,
      amount,
      date,
      paymentMethod,
      responsibleName,
      notes,
      status,
      date.slice(0, 7),
      new Date().toISOString(),
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'editar',
      entityType: 'despesa',
      entityId: id,
      summary: `Despesa editada: ${description}`,
      amount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.patch('/api/finance/expenses/:id/toggle', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const row = db
    .prepare('SELECT description, amount, status FROM expenses WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId) as Row | undefined;
  if (!row) {
    res.status(404).json({ error: 'Despesa não encontrada.' });
    return;
  }

  const nextStatus = row.status === 'pago' ? 'pendente' : 'pago';
  runInTransaction(() => {
    db.prepare('UPDATE expenses SET status = ?, updated_at = ? WHERE id = ? AND family_id = ?').run(
      nextStatus,
      new Date().toISOString(),
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'pagamento',
      entityType: 'despesa',
      entityId: id,
      summary: `Despesa marcada como ${nextStatus}: ${String(row.description)}`,
      amount: Number(row.amount),
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.delete('/api/finance/expenses/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const row = db
    .prepare('SELECT description, amount FROM expenses WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId) as Row | undefined;
  if (!row) {
    res.status(404).json({ error: 'Despesa não encontrada.' });
    return;
  }

  runInTransaction(() => {
    db.prepare('DELETE FROM expenses WHERE id = ? AND family_id = ?').run(id, ctx.familyId);
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'excluir',
      entityType: 'despesa',
      entityId: id,
      summary: `Despesa excluída: ${String(row.description)}`,
      amount: Number(row.amount),
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/fixed-bills', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 100);
  const expectedAmount = clampAmount(body.expectedAmount);
  const dueDay = Math.max(1, Math.min(31, Math.round(Number(body.dueDay) || 10)));
  const frequency = normalizeFrequency(body.frequency);
  const category = clampText(body.category || 'Contas da Casa', 60);
  const subcategory = clampText(body.subcategory || 'Outras contas', 60);
  const active = body.active !== false ? 1 : 0;
  const notes = clampText(body.notes, 500);

  if (!name || expectedAmount <= 0) {
    res.status(400).json({ error: 'Informe nome e valor previsto para a conta fixa.' });
    return;
  }

  const id = generateId('bill');
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
      ctx.familyId,
      name,
      expectedAmount,
      dueDay,
      frequency,
      category,
      subcategory,
      active,
      notes,
      ctx.user.uid,
      ctx.user.displayName,
      now,
      now
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'criar',
      entityType: 'conta_fixa',
      entityId: id,
      summary: `Conta fixa cadastrada: ${name}`,
      amount: expectedAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.put('/api/finance/fixed-bills/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const existing = db
    .prepare('SELECT id FROM fixed_bills WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId);
  if (!existing) {
    res.status(404).json({ error: 'Conta fixa não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 100);
  const expectedAmount = clampAmount(body.expectedAmount);
  const dueDay = Math.max(1, Math.min(31, Math.round(Number(body.dueDay) || 10)));
  const frequency = normalizeFrequency(body.frequency);
  const category = clampText(body.category || 'Contas da Casa', 60);
  const subcategory = clampText(body.subcategory || 'Outras contas', 60);
  const active = body.active !== false ? 1 : 0;
  const notes = clampText(body.notes, 500);

  runInTransaction(() => {
    db.prepare(
      `UPDATE fixed_bills SET
        name = ?, expected_amount = ?, due_day = ?, frequency = ?, category = ?,
        subcategory = ?, active = ?, notes = ?, updated_at = ?
       WHERE id = ? AND family_id = ?`
    ).run(
      name,
      expectedAmount,
      dueDay,
      frequency,
      category,
      subcategory,
      active,
      notes,
      new Date().toISOString(),
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'editar',
      entityType: 'conta_fixa',
      entityId: id,
      summary: `Conta fixa atualizada: ${name}`,
      amount: expectedAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/fixed-bills/:id/pay', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const billId = String(req.params.id || '');
  const bill = db
    .prepare('SELECT * FROM fixed_bills WHERE id = ? AND family_id = ?')
    .get(billId, ctx.familyId) as Row | undefined;
  if (!bill) {
    res.status(404).json({ error: 'Conta fixa não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const paidAmount = clampAmount(body.paidAmount);
  const paidDate = normalizeIsoDate(body.paidDate, getTodayBrazilISO());
  const paidMonth = paidDate.slice(0, 7);
  const paymentMethod = clampText(body.paymentMethod || 'PIX', 40);

  if (paidAmount <= 0) {
    res.status(400).json({ error: 'Informe um valor pago positivo.' });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    db.prepare(
      `UPDATE fixed_bills SET last_paid_month = ?, last_paid_date = ?, last_paid_amount = ?, updated_at = ?
       WHERE id = ? AND family_id = ?`
    ).run(paidMonth, paidDate, paidAmount, now, billId, ctx.familyId);
    db.prepare(
      `INSERT INTO expenses (
        id, family_id, description, category, subcategory, amount, date, payment_method,
        responsible_name, responsible_uid, notes, status, is_installment, is_recurring,
        fixed_bill_id, reference_month, created_by_uid, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pago', 0, 1, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateId('exp'),
      ctx.familyId,
      String(bill.name),
      String(bill.category),
      String(bill.subcategory),
      paidAmount,
      paidDate,
      paymentMethod,
      ctx.user.displayName,
      ctx.user.uid,
      'Pagamento de conta fixa',
      billId,
      paidMonth,
      ctx.user.uid,
      ctx.user.displayName,
      now,
      now
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'pagamento',
      entityType: 'conta_fixa',
      entityId: billId,
      summary: `Conta fixa paga: ${String(bill.name)}`,
      amount: paidAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.delete('/api/finance/fixed-bills/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const bill = db
    .prepare('SELECT name FROM fixed_bills WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId) as Row | undefined;
  if (!bill) {
    res.status(404).json({ error: 'Conta fixa não encontrada.' });
    return;
  }

  runInTransaction(() => {
    db.prepare('DELETE FROM fixed_bills WHERE id = ? AND family_id = ?').run(id, ctx.familyId);
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'excluir',
      entityType: 'conta_fixa',
      entityId: id,
      summary: `Conta fixa removida: ${String(bill.name)}`,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/debts', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 100);
  const creditor = clampText(body.creditor || 'Credor', 100);
  const originalAmount = clampAmount(body.originalAmount);
  const currentAmount = clampAmount(body.currentAmount);
  const installmentAmount = clampAmount(body.installmentAmount);
  const totalInstallments = Math.max(1, Math.round(Number(body.totalInstallments) || 1));
  const paidInstallments = Math.max(0, Math.round(Number(body.paidInstallments) || 0));
  const interestRate = Math.max(0, Number(body.interestRate) || 0);
  const dueDate = normalizeIsoDate(body.dueDate, getTodayBrazilISO());
  const notes = clampText(body.notes, 500);
  const status = currentAmount <= 0 ? 'quitada' : 'ativa';

  if (!name) {
    res.status(400).json({ error: 'Informe o nome da dívida.' });
    return;
  }

  const id = generateId('dbt');
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
      ctx.familyId,
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
      ctx.user.uid,
      ctx.user.displayName,
      now,
      now
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'criar',
      entityType: 'divida',
      entityId: id,
      summary: `Dívida cadastrada: ${name}`,
      amount: currentAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.put('/api/finance/debts/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const existing = db
    .prepare('SELECT id FROM debts WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId);
  if (!existing) {
    res.status(404).json({ error: 'Dívida não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 100);
  const creditor = clampText(body.creditor || 'Credor', 100);
  const originalAmount = clampAmount(body.originalAmount);
  const currentAmount = clampAmount(body.currentAmount);
  const installmentAmount = clampAmount(body.installmentAmount);
  const totalInstallments = Math.max(1, Math.round(Number(body.totalInstallments) || 1));
  const paidInstallments = Math.max(0, Math.round(Number(body.paidInstallments) || 0));
  const interestRate = Math.max(0, Number(body.interestRate) || 0);
  const dueDate = normalizeIsoDate(body.dueDate, getTodayBrazilISO());
  const notes = clampText(body.notes, 500);
  const status = currentAmount <= 0 ? 'quitada' : 'ativa';

  runInTransaction(() => {
    db.prepare(
      `UPDATE debts SET
        name = ?, creditor = ?, original_amount = ?, current_amount = ?, installment_amount = ?,
        total_installments = ?, paid_installments = ?, interest_rate = ?, due_date = ?,
        status = ?, notes = ?, updated_at = ?
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
      new Date().toISOString(),
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'editar',
      entityType: 'divida',
      entityId: id,
      summary: `Dívida editada: ${name}`,
      amount: currentAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/debts/:id/pay', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const debtId = String(req.params.id || '');
  const debt = db
    .prepare('SELECT * FROM debts WHERE id = ? AND family_id = ?')
    .get(debtId, ctx.familyId) as Row | undefined;
  if (!debt) {
    res.status(404).json({ error: 'Dívida não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const payAmount = clampAmount(body.amount);
  if (payAmount <= 0) {
    res.status(400).json({ error: 'Informe um valor positivo para pagamento.' });
    return;
  }

  const payDate = normalizeIsoDate(body.date, getTodayBrazilISO());
  const paymentType =
    body.paymentType === 'parcial' || body.paymentType === 'quitacao'
      ? body.paymentType
      : 'parcela';
  const currentAmt = Number(debt.current_amount);
  const nextCurrent =
    paymentType === 'quitacao'
      ? 0
      : Math.max(0, Math.round((currentAmt - payAmount) * 100) / 100);
  const totalInst = Number(debt.total_installments);
  const paidInst = Number(debt.paid_installments);
  const nextPaidInst =
    paymentType === 'quitacao'
      ? totalInst
      : paymentType === 'parcela'
      ? Math.min(totalInst, paidInst + 1)
      : paidInst;
  const nextStatus = nextCurrent <= 0 ? 'quitada' : 'ativa';
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      'UPDATE debts SET current_amount = ?, paid_installments = ?, status = ?, updated_at = ? WHERE id = ? AND family_id = ?'
    ).run(nextCurrent, nextPaidInst, nextStatus, now, debtId, ctx.familyId);
    db.prepare(
      `INSERT INTO debt_payments (
        id, family_id, debt_id, debt_name, amount, date, payment_type, notes,
        created_by_uid, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateId('dpay'),
      ctx.familyId,
      debtId,
      String(debt.name),
      payAmount,
      payDate,
      paymentType,
      clampText(body.notes, 500),
      ctx.user.uid,
      ctx.user.displayName,
      now
    );
    if (body.recordAsExpense) {
      db.prepare(
        `INSERT INTO expenses (
          id, family_id, description, category, subcategory, amount, date, payment_method,
          responsible_name, responsible_uid, notes, status, is_installment, is_recurring,
          reference_month, created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, 'Outras Despesas', 'Outros', ?, ?, ?, ?, ?, ?, 'pago', 0, 0, ?, ?, ?, ?, ?)`
      ).run(
        generateId('exp'),
        ctx.familyId,
        clampText(`Amortização de dívida: ${String(debt.name)}`, 140),
        payAmount,
        payDate,
        clampText(body.paymentMethod || 'PIX', 40),
        ctx.user.displayName,
        ctx.user.uid,
        clampText(body.notes || `Credor: ${String(debt.creditor)}`, 500),
        payDate.slice(0, 7),
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
    }
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'pagamento',
      entityType: 'divida',
      entityId: debtId,
      summary: `Pagamento registrado na dívida ${String(debt.name)}`,
      amount: payAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.delete('/api/finance/debts/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const debt = db
    .prepare('SELECT name FROM debts WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId) as Row | undefined;
  if (!debt) {
    res.status(404).json({ error: 'Dívida não encontrada.' });
    return;
  }

  runInTransaction(() => {
    db.prepare('DELETE FROM debts WHERE id = ? AND family_id = ?').run(id, ctx.familyId);
    db.prepare('DELETE FROM debt_payments WHERE debt_id = ? AND family_id = ?').run(
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'excluir',
      entityType: 'divida',
      entityId: id,
      summary: `Dívida removida: ${String(debt.name)}`,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/reserves', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 100);
  const targetAmount = clampAmount(body.targetAmount);
  const monthlyContribution = clampAmount(body.monthlyContribution);
  const notes = clampText(body.notes, 500);

  if (!name || targetAmount <= 0) {
    res.status(400).json({ error: 'Informe nome e valor objetivo para a reserva.' });
    return;
  }

  const id = generateId('res');
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `INSERT INTO reserves (
        id, family_id, name, target_amount, current_amount, monthly_contribution, notes,
        created_by_uid, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      ctx.familyId,
      name,
      targetAmount,
      monthlyContribution,
      notes,
      ctx.user.uid,
      ctx.user.displayName,
      now,
      now
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'reserva',
      entityType: 'reserva',
      entityId: id,
      summary: `Meta de reserva criada: ${name}`,
      amount: targetAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.put('/api/finance/reserves/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const existing = db
    .prepare('SELECT id FROM reserves WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId);
  if (!existing) {
    res.status(404).json({ error: 'Meta de reserva não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const name = clampText(body.name, 100);
  const targetAmount = clampAmount(body.targetAmount);
  const monthlyContribution = clampAmount(body.monthlyContribution);
  const notes = clampText(body.notes, 500);

  runInTransaction(() => {
    db.prepare(
      `UPDATE reserves SET name = ?, target_amount = ?, monthly_contribution = ?, notes = ?, updated_at = ?
       WHERE id = ? AND family_id = ?`
    ).run(
      name,
      targetAmount,
      monthlyContribution,
      notes,
      new Date().toISOString(),
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'editar',
      entityType: 'reserva',
      entityId: id,
      summary: `Meta de reserva atualizada: ${name}`,
      amount: targetAmount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/reserves/:id/move', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const goalId = String(req.params.id || '');
  const goal = db
    .prepare('SELECT * FROM reserves WHERE id = ? AND family_id = ?')
    .get(goalId, ctx.familyId) as Row | undefined;
  if (!goal) {
    res.status(404).json({ error: 'Meta de reserva não encontrada.' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const type = body.type === 'retirada' ? 'retirada' : 'deposito';
  const amount = clampAmount(body.amount);
  if (amount <= 0) {
    res.status(400).json({ error: 'Informe um valor positivo.' });
    return;
  }

  const current = Number(goal.current_amount);
  const nextAmount =
    type === 'deposito'
      ? Math.round((current + amount) * 100) / 100
      : Math.max(0, Math.round((current - amount) * 100) / 100);
  const moveDate = normalizeIsoDate(body.date, getTodayBrazilISO());
  const now = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      'UPDATE reserves SET current_amount = ?, updated_at = ? WHERE id = ? AND family_id = ?'
    ).run(nextAmount, now, goalId, ctx.familyId);
    db.prepare(
      `INSERT INTO reserve_movements (
        id, family_id, goal_id, goal_name, type, amount, date, notes,
        created_by_uid, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateId('rmv'),
      ctx.familyId,
      goalId,
      String(goal.name),
      type,
      amount,
      moveDate,
      clampText(body.notes, 500),
      ctx.user.uid,
      ctx.user.displayName,
      now
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'reserva',
      entityType: 'reserva',
      entityId: goalId,
      summary: `${type === 'deposito' ? 'Depósito' : 'Retirada'} em ${String(goal.name)}`,
      amount,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.delete('/api/finance/reserves/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const goal = db
    .prepare('SELECT name FROM reserves WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId) as Row | undefined;
  if (!goal) {
    res.status(404).json({ error: 'Meta de reserva não encontrada.' });
    return;
  }

  runInTransaction(() => {
    db.prepare('DELETE FROM reserves WHERE id = ? AND family_id = ?').run(id, ctx.familyId);
    db.prepare('DELETE FROM reserve_movements WHERE goal_id = ? AND family_id = ?').run(
      id,
      ctx.familyId
    );
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'excluir',
      entityType: 'reserva',
      entityId: id,
      summary: `Meta de reserva excluída: ${String(goal.name)}`,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/budgets', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const body = (req.body || {}) as Record<string, unknown>;
  const category = clampText(body.category, 60);
  const monthlyLimit = clampAmount(body.monthlyLimit);
  const existingId = typeof body.existingId === 'string' ? body.existingId : undefined;

  if (!category || monthlyLimit <= 0) {
    res.status(400).json({ error: 'Informe categoria e limite mensal positivo.' });
    return;
  }

  const now = new Date().toISOString();
  runInTransaction(() => {
    if (existingId) {
      db.prepare(
        'UPDATE budgets SET category = ?, monthly_limit = ?, updated_at = ? WHERE id = ? AND family_id = ?'
      ).run(category, monthlyLimit, now, existingId, ctx.familyId);
      insertAuditLog({
        familyId: ctx.familyId,
        action: 'editar',
        entityType: 'orcamento',
        entityId: existingId,
        summary: `Limite atualizado para ${category}`,
        amount: monthlyLimit,
        user: ctx.user,
      });
    } else {
      const id = generateId('bdg');
      db.prepare(
        `INSERT INTO budgets (
          id, family_id, category, monthly_limit, month, created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'padrao', ?, ?, ?, ?)`
      ).run(id, ctx.familyId, category, monthlyLimit, ctx.user.uid, ctx.user.displayName, now, now);
      insertAuditLog({
        familyId: ctx.familyId,
        action: 'criar',
        entityType: 'orcamento',
        entityId: id,
        summary: `Limite definido para ${category}`,
        amount: monthlyLimit,
        user: ctx.user,
      });
    }
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.delete('/api/finance/budgets/:id', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;
  const id = String(req.params.id || '');
  const row = db
    .prepare('SELECT category FROM budgets WHERE id = ? AND family_id = ?')
    .get(id, ctx.familyId) as Row | undefined;
  if (!row) {
    res.status(404).json({ error: 'Orçamento não encontrado.' });
    return;
  }

  runInTransaction(() => {
    db.prepare('DELETE FROM budgets WHERE id = ? AND family_id = ?').run(id, ctx.familyId);
    insertAuditLog({
      familyId: ctx.familyId,
      action: 'excluir',
      entityType: 'orcamento',
      entityId: id,
      summary: `Limite removido: ${String(row.category)}`,
      user: ctx.user,
    });
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json(getFamilySnapshot(ctx.familyId));
});

app.post('/api/finance/restore-backup', requireAuth, (req: RequestWithUser, res: Response) => {
  const ctx = requireFamily(req, res);
  if (!ctx) return;

  const body = (req.body || {}) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const userRow = db
    .prepare('SELECT password_hash FROM users WHERE uid = ?')
    .get(ctx.user.uid) as Row | undefined;
  if (!userRow || !verifySecret(currentPassword, String(userRow.password_hash))) {
    res.status(401).json({ error: 'Senha atual incorreta.' });
    return;
  }

  const backup = (body.backup || {}) as Record<string, unknown[]>;
  const now = new Date().toISOString();
  let restoredCount = 0;

  runInTransaction(() => {
    for (const raw of backup.incomes || []) {
      const item = (raw || {}) as Row;
      const amount = clampAmount(item.amount);
      const description = clampText(item.description, 140);
      if (!description || amount <= 0) continue;
      db.prepare(
        `INSERT INTO incomes (
          id, family_id, description, amount, date, category, responsible_name, responsible_uid, notes,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId('inc'),
        ctx.familyId,
        description,
        amount,
        normalizeIsoDate(item.date, getTodayBrazilISO()),
        clampText(item.category || 'Outros recebimentos', 60),
        clampText(item.responsibleName || ctx.user.displayName, 80),
        ctx.user.uid,
        clampText(item.notes, 500),
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
      restoredCount += 1;
    }

    for (const raw of backup.expenses || []) {
      const item = (raw || {}) as Row;
      const amount = clampAmount(item.amount);
      const description = clampText(item.description, 140);
      if (!description || amount <= 0) continue;
      const date = normalizeIsoDate(item.date, getTodayBrazilISO());
      db.prepare(
        `INSERT INTO expenses (
          id, family_id, description, category, subcategory, amount, date, payment_method,
          responsible_name, responsible_uid, notes, status, is_installment, is_recurring,
          reference_month, created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`
      ).run(
        generateId('exp'),
        ctx.familyId,
        description,
        clampText(item.category || 'Outras Despesas', 60),
        clampText(item.subcategory || 'Outros', 60),
        amount,
        date,
        clampText(item.paymentMethod || 'PIX', 40),
        clampText(item.responsibleName || ctx.user.displayName, 80),
        ctx.user.uid,
        clampText(item.notes, 500),
        item.status === 'pendente' ? 'pendente' : 'pago',
        date.slice(0, 7),
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
      restoredCount += 1;
    }

    for (const raw of backup.fixedBills || []) {
      const item = (raw || {}) as Row;
      const name = clampText(item.name, 100);
      const expectedAmount = clampAmount(item.expectedAmount);
      if (!name || expectedAmount <= 0) continue;
      db.prepare(
        `INSERT INTO fixed_bills (
          id, family_id, name, expected_amount, due_day, frequency, category, subcategory,
          last_paid_month, last_paid_date, last_paid_amount, active, notes,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, 1, ?, ?, ?, ?, ?)`
      ).run(
        generateId('bill'),
        ctx.familyId,
        name,
        expectedAmount,
        Math.max(1, Math.min(31, Math.round(Number(item.dueDay) || 10))),
        normalizeFrequency(item.frequency),
        clampText(item.category || 'Contas da Casa', 60),
        clampText(item.subcategory || 'Outras contas', 60),
        clampText(item.notes, 500),
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
      restoredCount += 1;
    }

    for (const raw of backup.debts || []) {
      const item = (raw || {}) as Row;
      const name = clampText(item.name, 100);
      if (!name) continue;
      const currentAmount = clampAmount(item.currentAmount);
      db.prepare(
        `INSERT INTO debts (
          id, family_id, name, creditor, original_amount, current_amount, installment_amount,
          total_installments, paid_installments, interest_rate, due_date, status, notes,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId('dbt'),
        ctx.familyId,
        name,
        clampText(item.creditor || 'Credor', 100),
        clampAmount(item.originalAmount),
        currentAmount,
        clampAmount(item.installmentAmount),
        Math.max(1, Math.round(Number(item.totalInstallments) || 1)),
        Math.max(0, Math.round(Number(item.paidInstallments) || 0)),
        Math.max(0, Number(item.interestRate) || 0),
        normalizeIsoDate(item.dueDate, getTodayBrazilISO()),
        currentAmount <= 0 ? 'quitada' : 'ativa',
        clampText(item.notes, 500),
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
      restoredCount += 1;
    }

    for (const raw of backup.reserves || []) {
      const item = (raw || {}) as Row;
      const name = clampText(item.name, 100);
      const targetAmount = clampAmount(item.targetAmount);
      if (!name || targetAmount <= 0) continue;
      db.prepare(
        `INSERT INTO reserves (
          id, family_id, name, target_amount, current_amount, monthly_contribution, notes,
          created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId('res'),
        ctx.familyId,
        name,
        targetAmount,
        clampAmount(item.currentAmount),
        clampAmount(item.monthlyContribution),
        clampText(item.notes, 500),
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
      restoredCount += 1;
    }

    for (const raw of backup.budgets || []) {
      const item = (raw || {}) as Row;
      const category = clampText(item.category, 60);
      const monthlyLimit = clampAmount(item.monthlyLimit);
      if (!category || monthlyLimit <= 0) continue;
      db.prepare(
        `INSERT INTO budgets (
          id, family_id, category, monthly_limit, month, created_by_uid, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'padrao', ?, ?, ?, ?)`
      ).run(
        generateId('bdg'),
        ctx.familyId,
        category,
        monthlyLimit,
        ctx.user.uid,
        ctx.user.displayName,
        now,
        now
      );
      restoredCount += 1;
    }

    if (restoredCount > 0) {
      insertAuditLog({
        familyId: ctx.familyId,
        action: 'criar',
        entityType: 'backup',
        entityId: ctx.familyId,
        summary: `Backup restaurado: ${restoredCount} registro(s)`,
        user: ctx.user,
      });
    }
  });

  broadcastFamilySync(ctx.familyId, 'finance');
  res.json({ restoredCount, snapshot: getFamilySnapshot(ctx.familyId) });
});

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
    app.get('*', (req: Request, res: Response) => {
      if (/\.(wasm|js|css|png|svg|ico|json|webmanifest|woff2?)$/i.test(req.path)) {
        res.status(404).send('Arquivo não encontrado.');
        return;
      }
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
    console.log(`Blessed Finance server listening on port ${PORT} (Built-in SQLite + PWA)`);
  });
}

void startServer();
