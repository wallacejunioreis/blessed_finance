import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.resolve(dataDir, 'blessed-finance.db');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    recovery_code_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    family_id TEXT,
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_uid TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS family_members (
    family_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    invite_code TEXT,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (family_id, uid),
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS incomes (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    responsible_name TEXT NOT NULL,
    responsible_uid TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    responsible_name TEXT NOT NULL,
    responsible_uid TEXT,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    is_installment INTEGER NOT NULL DEFAULT 0,
    installment_group_id TEXT,
    installment_number INTEGER,
    total_installments INTEGER,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    fixed_bill_id TEXT,
    reference_month TEXT,
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fixed_bills (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    name TEXT NOT NULL,
    expected_amount REAL NOT NULL,
    due_day INTEGER NOT NULL,
    frequency TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    last_paid_month TEXT NOT NULL DEFAULT '',
    last_paid_date TEXT NOT NULL DEFAULT '',
    last_paid_amount REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS debts (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    name TEXT NOT NULL,
    creditor TEXT NOT NULL,
    original_amount REAL NOT NULL,
    current_amount REAL NOT NULL,
    installment_amount REAL NOT NULL,
    total_installments INTEGER NOT NULL,
    paid_installments INTEGER NOT NULL,
    interest_rate REAL NOT NULL DEFAULT 0,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS debt_payments (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    debt_id TEXT NOT NULL,
    debt_name TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    payment_type TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reserves (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    name TEXT NOT NULL,
    target_amount REAL NOT NULL,
    current_amount REAL NOT NULL DEFAULT 0,
    monthly_contribution REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reserve_movements (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    goal_name TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    category TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    month TEXT NOT NULL,
    created_by_uid TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    amount REAL,
    performed_by_uid TEXT NOT NULL,
    performed_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_uid);
  CREATE INDEX IF NOT EXISTS idx_incomes_family ON incomes(family_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_expenses_family ON expenses(family_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_fixed_bills_family ON fixed_bills(family_id);
  CREATE INDEX IF NOT EXISTS idx_debts_family ON debts(family_id);
  CREATE INDEX IF NOT EXISTS idx_debt_payments_family ON debt_payments(family_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_reserves_family ON reserves(family_id);
  CREATE INDEX IF NOT EXISTS idx_reserve_movements_family ON reserve_movements(family_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_budgets_family ON budgets(family_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_family ON audit_logs(family_id, created_at DESC);
`);

export function runInTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(secret: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derived = crypto.scryptSync(secret, salt, 64);
    if (keyBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(keyBuf, derived);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateDocId(prefix: string): string {
  const rand = crypto.randomBytes(6).toString('hex');
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export function generateRecoveryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i++) {
    if (i === 5) code += '-';
    code += chars[bytes[i] % chars.length];
  }
  return code;
}
