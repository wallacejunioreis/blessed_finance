import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import writeXlsxFile, { SheetData } from 'write-excel-file/browser';
import { formatBRL, formatDateBR, getTodayBrazilISO } from './formatters';

export interface ReportExportPayload {
  title: string;
  subtitle: string;
  familyName: string;
  periodLabel: string;
  summaryRows: { label: string; value: string }[];
  columns: string[];
  rows: (string | number)[][];
  sheetName: string;
  fileNameBase: string;
}

export function exportReportToPDF(payload: ReportExportPayload): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFillColor(13, 59, 46);
  doc.rect(0, 0, 210, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text('Blessed Finance', 14, 12);

  doc.setFontSize(10);
  doc.setTextColor(224, 242, 233);
  doc.text(`${payload.familyName} · ${payload.periodLabel}`, 14, 20);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(14);
  doc.text(payload.title, 14, 38);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${payload.subtitle} · Emitido em ${formatDateBR(getTodayBrazilISO())}`, 14, 44);

  let yPos = 52;

  if (payload.summaryRows.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Indicador', 'Valor']],
      body: payload.summaryRows.map((r) => [r.label, r.value]),
      theme: 'grid',
      headStyles: { fillColor: [13, 59, 46], textColor: [255, 255, 255], fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: [30, 41, 59] },
      margin: { left: 14, right: 14 },
    });
    const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    yPos = (lastTable?.finalY ?? yPos) + 8;
  }

  if (payload.rows.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [payload.columns],
      body: payload.rows.map((row) =>
        row.map((cell) => (typeof cell === 'number' ? formatBRL(cell) : String(cell)))
      ),
      theme: 'striped',
      headStyles: { fillColor: [31, 111, 84], textColor: [255, 255, 255], fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
      margin: { left: 14, right: 14 },
    });
  }

  doc.save(`${payload.fileNameBase}_${getTodayBrazilISO()}.pdf`);
}

export async function exportReportToExcel(payload: ReportExportPayload): Promise<void> {
  const summarySheet: SheetData = [
    [{ value: 'Blessed Finance — Relatório Financeiro Familiar', fontWeight: 'bold' }],
    [{ value: 'Família' }, { value: payload.familyName }],
    [{ value: 'Relatório' }, { value: payload.title }],
    [{ value: 'Período' }, { value: payload.periodLabel }],
    [{ value: 'Data de emissão' }, { value: formatDateBR(getTodayBrazilISO()) }],
    [],
    [{ value: 'Indicador', fontWeight: 'bold' }, { value: 'Valor', fontWeight: 'bold' }],
    ...payload.summaryRows.map((r) => [{ value: r.label }, { value: r.value }]),
  ];

  const detailsSheet: SheetData = [
    payload.columns.map((c) => ({ value: c, fontWeight: 'bold' as const })),
    ...payload.rows.map((row) =>
      row.map((cell) =>
        typeof cell === 'number'
          ? { type: Number, value: cell, format: '#,##0.00' }
          : { type: String, value: String(cell) }
      )
    ),
  ];

  await writeXlsxFile(
    [
      { sheet: 'Resumo', data: summarySheet },
      { sheet: payload.sheetName.slice(0, 31), data: detailsSheet },
    ]
  ).toFile(`${payload.fileNameBase}_${getTodayBrazilISO()}.xlsx`);
}

export interface FamilyBackupData {
  app: 'Blessed Finance';
  version: 1;
  exportedAt: string;
  familyName: string;
  incomes: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  fixedBills: Record<string, unknown>[];
  debts: Record<string, unknown>[];
  reserves: Record<string, unknown>[];
  budgets: Record<string, unknown>[];
}

export const MAX_BACKUP_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

export function parseAndValidateBackupJSON(rawText: string): FamilyBackupData {
  if (rawText.length > MAX_BACKUP_FILE_BYTES) {
    throw new Error('O arquivo de backup excede o limite máximo de 2 MB.');
  }

  // Strip prototype-pollution keys during JSON parsing
  const parsed = JSON.parse(rawText, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    return value;
  }) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Estrutura de backup inválida.');
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.app !== 'Blessed Finance' || obj.version !== 1) {
    throw new Error('Arquivo incompatível com o formato de backup do Blessed Finance.');
  }
  if (!Array.isArray(obj.incomes) || !Array.isArray(obj.expenses)) {
    throw new Error('O arquivo de backup não contém registros financeiros válidos.');
  }

  return obj as unknown as FamilyBackupData;
}

export function downloadFamilyBackupJSON(data: FamilyBackupData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blessed_finance_backup_${getTodayBrazilISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
