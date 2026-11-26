import { MAX_LENGTHS } from '../types/finance';

export function formatBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(1).replace('.', ',')}%`;
}

export function formatDateBR(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function getTodayBrazilISO(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function getCurrentMonthBrazil(): string {
  return getTodayBrazilISO().slice(0, 7);
}

const MONTHS_SHORT_PT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

const MONTHS_LONG_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export function getMonthShortLabelBR(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTHS_SHORT_PT[idx] ?? m}/${y.slice(2)}`;
}

export function getMonthLongLabelBR(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTHS_LONG_PT[idx] ?? m} de ${y}`;
}

export function addMonthsToISO(isoDate: string, monthsToAdd: number): string {
  const [yStr, mStr, dStr] = isoDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const targetMonthIndex = month + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDaysInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const safeDay = Math.min(day, maxDaysInTargetMonth);
  const mm = String(normalizedMonth + 1).padStart(2, '0');
  const dd = String(safeDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function shiftMonth(ym: string, deltaMonths: number): string {
  const [yStr, mStr] = ym.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const target = month + deltaMonths;
  const targetYear = year + Math.floor(target / 12);
  const normalizedMonth = ((target % 12) + 12) % 12;
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}`;
}

export function getLastDayOfMonth(ym: string): string {
  const [yStr, mStr] = ym.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const lastDay = new Date(year, month, 0).getDate();
  return `${ym}-${String(lastDay).padStart(2, '0')}`;
}

export function clampText(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export function clampAmount(val: number): number {
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.min(Math.round(val * 100) / 100, 100000000);
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, MAX_LENGTHS.summary);
}
