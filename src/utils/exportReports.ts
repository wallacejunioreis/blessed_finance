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

export interface PowerBIExportInput {
  familyName: string;
  incomes: Array<{
    id: string;
    description: string;
    amount: number;
    date: string;
    category: string;
    responsibleName: string;
    createdByName: string;
  }>;
  expenses: Array<{
    id: string;
    description: string;
    category: string;
    subcategory: string;
    amount: number;
    date: string;
    paymentMethod: string;
    responsibleName: string;
    status: string;
    isInstallment: boolean;
    isRecurring: boolean;
    createdByName: string;
  }>;
  fixedBills: Array<{
    id: string;
    name: string;
    expectedAmount: number;
    dueDay: number;
    frequency: string;
    category: string;
    subcategory: string;
    lastPaidMonth: string;
    lastPaidAmount: number;
    active: boolean;
  }>;
  debts: Array<{
    id: string;
    name: string;
    creditor: string;
    originalAmount: number;
    currentAmount: number;
    installmentAmount: number;
    totalInstallments: number;
    paidInstallments: number;
    interestRate: number;
    dueDate: string;
    status: string;
  }>;
  reserves: Array<{
    id: string;
    name: string;
    targetAmount: number;
    currentAmount: number;
    monthlyContribution: number;
  }>;
  budgets: Array<{
    id: string;
    category: string;
    monthlyLimit: number;
    month: string;
  }>;
}

const MONTH_NAMES_PT = [
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

export async function exportPowerBIWorkbook(input: PowerBIExportInput): Promise<void> {
  const fatoLancamentos: SheetData = [
    [
      { value: 'ID', fontWeight: 'bold' },
      { value: 'Tipo', fontWeight: 'bold' },
      { value: 'Data', fontWeight: 'bold' },
      { value: 'Ano', fontWeight: 'bold' },
      { value: 'MesAno', fontWeight: 'bold' },
      { value: 'Descricao', fontWeight: 'bold' },
      { value: 'Categoria', fontWeight: 'bold' },
      { value: 'Subcategoria', fontWeight: 'bold' },
      { value: 'FormaPagamento', fontWeight: 'bold' },
      { value: 'Responsavel', fontWeight: 'bold' },
      { value: 'Status', fontWeight: 'bold' },
      { value: 'Parcelado', fontWeight: 'bold' },
      { value: 'Recorrente', fontWeight: 'bold' },
      { value: 'Valor', fontWeight: 'bold' },
      { value: 'ValorComSinal', fontWeight: 'bold' },
      { value: 'RegistradoPor', fontWeight: 'bold' },
    ],
    ...input.incomes.map((i) => [
      { type: String, value: i.id },
      { type: String, value: 'Receita' },
      { type: String, value: i.date },
      { type: Number, value: Number(i.date.slice(0, 4)) || 2026 },
      { type: String, value: i.date.slice(0, 7) },
      { type: String, value: i.description },
      { type: String, value: i.category },
      { type: String, value: 'Entrada' },
      { type: String, value: 'Recebimento' },
      { type: String, value: i.responsibleName },
      { type: String, value: 'recebido' },
      { type: String, value: 'Não' },
      { type: String, value: 'Não' },
      { type: Number, value: i.amount, format: '#,##0.00' },
      { type: Number, value: i.amount, format: '#,##0.00' },
      { type: String, value: i.createdByName },
    ]),
    ...input.expenses.map((e) => [
      { type: String, value: e.id },
      { type: String, value: 'Despesa' },
      { type: String, value: e.date },
      { type: Number, value: Number(e.date.slice(0, 4)) || 2026 },
      { type: String, value: e.date.slice(0, 7) },
      { type: String, value: e.description },
      { type: String, value: e.category },
      { type: String, value: e.subcategory },
      { type: String, value: e.paymentMethod },
      { type: String, value: e.responsibleName },
      { type: String, value: e.status },
      { type: String, value: e.isInstallment ? 'Sim' : 'Não' },
      { type: String, value: e.isRecurring ? 'Sim' : 'Não' },
      { type: Number, value: e.amount, format: '#,##0.00' },
      { type: Number, value: -Math.abs(e.amount), format: '#,##0.00' },
      { type: String, value: e.createdByName },
    ]),
  ];

  const fatoContasFixas: SheetData = [
    [
      { value: 'ID', fontWeight: 'bold' },
      { value: 'Nome', fontWeight: 'bold' },
      { value: 'ValorPrevisto', fontWeight: 'bold' },
      { value: 'DiaVencimento', fontWeight: 'bold' },
      { value: 'Frequencia', fontWeight: 'bold' },
      { value: 'Categoria', fontWeight: 'bold' },
      { value: 'Subcategoria', fontWeight: 'bold' },
      { value: 'UltimoMesPago', fontWeight: 'bold' },
      { value: 'UltimoValorPago', fontWeight: 'bold' },
      { value: 'Ativa', fontWeight: 'bold' },
    ],
    ...input.fixedBills.map((b) => [
      { type: String, value: b.id },
      { type: String, value: b.name },
      { type: Number, value: b.expectedAmount, format: '#,##0.00' },
      { type: Number, value: b.dueDay },
      { type: String, value: b.frequency },
      { type: String, value: b.category },
      { type: String, value: b.subcategory },
      { type: String, value: b.lastPaidMonth || '' },
      { type: Number, value: b.lastPaidAmount || 0, format: '#,##0.00' },
      { type: String, value: b.active ? 'Sim' : 'Não' },
    ]),
  ];

  const fatoDividas: SheetData = [
    [
      { value: 'ID', fontWeight: 'bold' },
      { value: 'Nome', fontWeight: 'bold' },
      { value: 'Credor', fontWeight: 'bold' },
      { value: 'ValorOriginal', fontWeight: 'bold' },
      { value: 'SaldoAtual', fontWeight: 'bold' },
      { value: 'ValorParcela', fontWeight: 'bold' },
      { value: 'TotalParcelas', fontWeight: 'bold' },
      { value: 'ParcelasPagas', fontWeight: 'bold' },
      { value: 'JurosMensalPct', fontWeight: 'bold' },
      { value: 'Vencimento', fontWeight: 'bold' },
      { value: 'Status', fontWeight: 'bold' },
    ],
    ...input.debts.map((d) => [
      { type: String, value: d.id },
      { type: String, value: d.name },
      { type: String, value: d.creditor },
      { type: Number, value: d.originalAmount, format: '#,##0.00' },
      { type: Number, value: d.currentAmount, format: '#,##0.00' },
      { type: Number, value: d.installmentAmount, format: '#,##0.00' },
      { type: Number, value: d.totalInstallments },
      { type: Number, value: d.paidInstallments },
      { type: Number, value: d.interestRate, format: '0.00' },
      { type: String, value: d.dueDate },
      { type: String, value: d.status },
    ]),
  ];

  const fatoReservas: SheetData = [
    [
      { value: 'ID', fontWeight: 'bold' },
      { value: 'Meta', fontWeight: 'bold' },
      { value: 'ValorDesejado', fontWeight: 'bold' },
      { value: 'SaldoGuardado', fontWeight: 'bold' },
      { value: 'AporteMensal', fontWeight: 'bold' },
      { value: 'ProgressoPct', fontWeight: 'bold' },
    ],
    ...input.reserves.map((r) => [
      { type: String, value: r.id },
      { type: String, value: r.name },
      { type: Number, value: r.targetAmount, format: '#,##0.00' },
      { type: Number, value: r.currentAmount, format: '#,##0.00' },
      { type: Number, value: r.monthlyContribution, format: '#,##0.00' },
      {
        type: Number,
        value: r.targetAmount > 0 ? Math.round((r.currentAmount / r.targetAmount) * 1000) / 10 : 0,
        format: '0.0',
      },
    ]),
  ];

  const fatoOrcamentos: SheetData = [
    [
      { value: 'ID', fontWeight: 'bold' },
      { value: 'Categoria', fontWeight: 'bold' },
      { value: 'LimiteMensal', fontWeight: 'bold' },
      { value: 'MesReferencia', fontWeight: 'bold' },
    ],
    ...input.budgets.map((b) => [
      { type: String, value: b.id },
      { type: String, value: b.category },
      { type: Number, value: b.monthlyLimit, format: '#,##0.00' },
      { type: String, value: b.month },
    ]),
  ];

  const allDates = Array.from(
    new Set([
      getTodayBrazilISO(),
      ...input.incomes.map((i) => i.date),
      ...input.expenses.map((e) => e.date),
      ...input.debts.map((d) => d.dueDate),
    ])
  )
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  const dimCalendario: SheetData = [
    [
      { value: 'Data', fontWeight: 'bold' },
      { value: 'Ano', fontWeight: 'bold' },
      { value: 'MesNum', fontWeight: 'bold' },
      { value: 'MesNome', fontWeight: 'bold' },
      { value: 'MesAno', fontWeight: 'bold' },
      { value: 'Trimestre', fontWeight: 'bold' },
    ],
    ...allDates.map((d) => {
      const year = Number(d.slice(0, 4));
      const month = Number(d.slice(5, 7));
      const quarter = Math.ceil(month / 3);
      return [
        { type: String, value: d },
        { type: Number, value: year },
        { type: Number, value: month },
        { type: String, value: MONTH_NAMES_PT[month - 1] || String(month) },
        { type: String, value: d.slice(0, 7) },
        { type: String, value: `T${quarter}/${year}` },
      ];
    }),
  ];

  const uniqueCategories = Array.from(
    new Set([
      ...input.incomes.map((i) => i.category),
      ...input.expenses.map((e) => e.category),
      ...input.budgets.map((b) => b.category),
    ])
  ).sort();

  const dimCategorias: SheetData = [
    [
      { value: 'Categoria', fontWeight: 'bold' },
      { value: 'Familia', fontWeight: 'bold' },
    ],
    ...uniqueCategories.map((c) => [
      { type: String, value: c },
      { type: String, value: input.familyName },
    ]),
  ];

  await writeXlsxFile([
    { sheet: 'Fato_Lancamentos', data: fatoLancamentos },
    { sheet: 'Fato_ContasFixas', data: fatoContasFixas },
    { sheet: 'Fato_Dividas', data: fatoDividas },
    { sheet: 'Fato_Reservas', data: fatoReservas },
    { sheet: 'Fato_Orcamentos', data: fatoOrcamentos },
    { sheet: 'Dim_Calendario', data: dimCalendario },
    { sheet: 'Dim_Categorias', data: dimCategorias },
  ]).toFile(`Blessed_Finance_PowerBI_${getTodayBrazilISO()}.xlsx`);
}

export function downloadPowerBIThemeJSON(): void {
  const theme = {
    name: 'Blessed Finance',
    dataColors: [
      '#0D3B2E',
      '#1F6F54',
      '#C89B3C',
      '#16A34A',
      '#52796F',
      '#9A7B2C',
      '#84A98C',
      '#475569',
    ],
    background: '#F8FAF9',
    foreground: '#0F172A',
    tableAccent: '#0D3B2E',
    good: '#16A34A',
    neutral: '#C89B3C',
    bad: '#DC2626',
    visualStyles: {
      '*': {
        '*': {
          background: [{ color: { solid: { color: '#FFFFFF' } }, transparency: 0 }],
          border: [{ show: true, color: { solid: { color: '#E2E8F0' } }, radius: 10 }],
        },
      },
      card: {
        '*': {
          labels: [{ color: { solid: { color: '#0D3B2E' } }, fontSize: 26 }],
          categoryLabels: [{ color: { solid: { color: '#64748B' } }, fontSize: 11 }],
        },
      },
    },
  };

  const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Blessed_Finance_Tema_PowerBI.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const POWERBI_DAX_MEASURES = `// ==========================================================
// BLESSED FINANCE — MEDIDAS DAX PRONTAS PARA POWER BI DESKTOP
// Importe o Excel "Blessed_Finance_PowerBI_*.xlsx" e crie
// estas medidas na tabela Fato_Lancamentos.
// ==========================================================

Total Receitas =
CALCULATE(
    SUM(Fato_Lancamentos[Valor]),
    Fato_Lancamentos[Tipo] = "Receita"
)

Total Despesas =
CALCULATE(
    SUM(Fato_Lancamentos[Valor]),
    Fato_Lancamentos[Tipo] = "Despesa"
)

Despesas Pagas =
CALCULATE(
    SUM(Fato_Lancamentos[Valor]),
    Fato_Lancamentos[Tipo] = "Despesa",
    Fato_Lancamentos[Status] = "pago"
)

Despesas Pendentes =
CALCULATE(
    SUM(Fato_Lancamentos[Valor]),
    Fato_Lancamentos[Tipo] = "Despesa",
    Fato_Lancamentos[Status] = "pendente"
)

Saldo Liquido =
[Total Receitas] - [Total Despesas]

Margem Economia % =
DIVIDE([Saldo Liquido], [Total Receitas], 0)

Renda Comprometida % =
DIVIDE([Total Despesas], [Total Receitas], 0)

Total Dividas Ativas =
CALCULATE(
    SUM(Fato_Dividas[SaldoAtual]),
    Fato_Dividas[Status] = "ativa"
)

Total Reserva Guardada =
SUM(Fato_Reservas[SaldoGuardado])

Orcado Mensal =
SUM(Fato_Orcamentos[LimiteMensal])

Saldo Orcamento =
[Orcado Mensal] - [Total Despesas]
`;

export function downloadPowerBIDaxTxt(): void {
  const blob = new Blob([POWERBI_DAX_MEASURES], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Blessed_Finance_Medidas_DAX.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

