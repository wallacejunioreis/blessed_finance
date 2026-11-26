import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { PeriodFilterKey } from '../types/finance';
import {
  ReportExportPayload,
  exportReportToExcel,
  exportReportToPDF,
} from '../utils/exportReports';
import {
  buildExpenseByCategory,
  buildMonthlyChartSeries,
  buildPeriodFilter,
  getFixedBillStatusForMonth,
  isDateInPeriod,
} from '../utils/financeCalculations';
import { formatBRL, formatDateBR, getCurrentMonthBrazil } from '../utils/formatters';
import { DonutCategoryChart, GroupedBarChart } from './Charts';

type ReportType =
  | 'mensal'
  | 'anual'
  | 'receitas'
  | 'despesas'
  | 'dividas'
  | 'contas_fixas'
  | 'economia'
  | 'por_categoria'
  | 'por_integrante';

const REPORT_TYPES: { id: ReportType; label: string }[] = [
  { id: 'mensal', label: 'Relatório Mensal' },
  { id: 'anual', label: 'Relatório Anual' },
  { id: 'receitas', label: 'Relatório de Receitas' },
  { id: 'despesas', label: 'Relatório de Despesas' },
  { id: 'dividas', label: 'Relatório de Dívidas' },
  { id: 'contas_fixas', label: 'Relatório de Contas Fixas' },
  { id: 'economia', label: 'Relatório de Economia' },
  { id: 'por_categoria', label: 'Por Categoria' },
  { id: 'por_integrante', label: 'Por Integrante' },
];

export function ReportsView() {
  const { family } = useAuth();
  const {
    incomes,
    expenses,
    debts,
    debtPayments,
    fixedBills,
    reserves,
    reserveMovements,
  } = useFinance();

  const [reportType, setReportType] = useState<ReportType>('mensal');
  const [periodKey, setPeriodKey] = useState<PeriodFilterKey>('mes_atual');
  const [customStart, setCustomStart] = useState(`${getCurrentMonthBrazil()}-01`);
  const [customEnd, setCustomEnd] = useState(buildPeriodFilter('mes_atual').endDate);

  const effectivePeriodKey: PeriodFilterKey =
    reportType === 'anual' ? 'ano_atual' : periodKey;

  const filter = useMemo(
    () => buildPeriodFilter(effectivePeriodKey, customStart, customEnd),
    [effectivePeriodKey, customStart, customEnd]
  );

  const periodIncomes = useMemo(
    () => incomes.filter((i) => isDateInPeriod(i.date, filter)),
    [incomes, filter]
  );
  const periodExpenses = useMemo(
    () => expenses.filter((e) => isDateInPeriod(e.date, filter)),
    [expenses, filter]
  );
  const periodResMovements = useMemo(
    () => reserveMovements.filter((m) => isDateInPeriod(m.date, filter)),
    [reserveMovements, filter]
  );

  const monthlySeries = useMemo(
    () =>
      buildMonthlyChartSeries({
        incomes,
        expenses,
        reserveMovements,
        debtPayments,
        filter,
      }),
    [incomes, expenses, reserveMovements, debtPayments, filter]
  );

  const categoryBreakdown = useMemo(
    () => buildExpenseByCategory(expenses, filter),
    [expenses, filter]
  );

  const reportPayload: ReportExportPayload = useMemo(() => {
    const familyName = family?.name || 'Minha Família';
    const periodLabel = `${formatDateBR(filter.startDate)} a ${formatDateBR(filter.endDate)}`;
    const sumInc = periodIncomes.reduce((s, i) => s + i.amount, 0);
    const sumExp = periodExpenses.reduce((s, e) => s + e.amount, 0);
    const currentMonth = getCurrentMonthBrazil();

    switch (reportType) {
      case 'mensal':
      case 'anual': {
        return {
          title: reportType === 'anual' ? 'Relatório Anual Consolidado' : 'Relatório Mensal Consolidado',
          subtitle: 'Visão geral de receitas, despesas e economia líquida',
          familyName,
          periodLabel,
          summaryRows: [
            { label: 'Total de Receitas', value: formatBRL(sumInc) },
            { label: 'Total de Despesas', value: formatBRL(sumExp) },
            { label: 'Economia Líquida', value: formatBRL(sumInc - sumExp) },
          ],
          columns: ['Mês', 'Receitas', 'Despesas', 'Resultado'],
          rows: monthlySeries.map((m) => [m.label, m.incomes, m.expenses, m.net]),
          sheetName: 'Consolidado',
          fileNameBase: `relatorio_${reportType}`,
        };
      }
      case 'receitas':
        return {
          title: 'Relatório de Receitas',
          subtitle: 'Entradas financeiras registradas pela família',
          familyName,
          periodLabel,
          summaryRows: [
            { label: 'Quantidade de entradas', value: String(periodIncomes.length) },
            { label: 'Total recebido', value: formatBRL(sumInc) },
          ],
          columns: ['Data', 'Descrição', 'Categoria', 'Responsável', 'Valor'],
          rows: periodIncomes.map((i) => [
            formatDateBR(i.date),
            i.description,
            i.category,
            i.responsibleName,
            i.amount,
          ]),
          sheetName: 'Receitas',
          fileNameBase: 'relatorio_receitas',
        };
      case 'despesas':
        return {
          title: 'Relatório de Despesas',
          subtitle: 'Gastos detalhados da família no período',
          familyName,
          periodLabel,
          summaryRows: [
            { label: 'Quantidade de lançamentos', value: String(periodExpenses.length) },
            { label: 'Total de despesas', value: formatBRL(sumExp) },
          ],
          columns: ['Data', 'Descrição', 'Categoria', 'Subcategoria', 'Status', 'Valor'],
          rows: periodExpenses.map((e) => [
            formatDateBR(e.date),
            e.description,
            e.category,
            e.subcategory,
            e.status === 'pago' ? 'Pago' : 'Pendente',
            e.amount,
          ]),
          sheetName: 'Despesas',
          fileNameBase: 'relatorio_despesas',
        };
      case 'dividas': {
        const totalRemaining = debts
          .filter((d) => d.status === 'ativa')
          .reduce((s, d) => s + d.currentAmount, 0);
        return {
          title: 'Relatório de Dívidas',
          subtitle: 'Compromissos ativos, parcelas e progresso de quitação',
          familyName,
          periodLabel,
          summaryRows: [
            { label: 'Total de dívidas cadastradas', value: String(debts.length) },
            { label: 'Saldo restante a quitar', value: formatBRL(totalRemaining) },
          ],
          columns: ['Dívida', 'Credor', 'Parcelas', 'Juros %', 'Status', 'Saldo Atual'],
          rows: debts.map((d) => [
            d.name,
            d.creditor,
            `${d.paidInstallments}/${d.totalInstallments}`,
            `${d.interestRate.toFixed(1)}%`,
            d.status === 'quitada' ? 'Quitada' : 'Ativa',
            d.currentAmount,
          ]),
          sheetName: 'Dividas',
          fileNameBase: 'relatorio_dividas',
        };
      }
      case 'contas_fixas': {
        const totalExpected = fixedBills
          .filter((b) => b.active)
          .reduce((s, b) => s + b.expectedAmount, 0);
        return {
          title: 'Relatório de Contas Fixas',
          subtitle: 'Situação das contas recorrentes no mês atual',
          familyName,
          periodLabel,
          summaryRows: [
            { label: 'Contas fixas ativas', value: String(fixedBills.filter((b) => b.active).length) },
            { label: 'Valor previsto mensal', value: formatBRL(totalExpected) },
          ],
          columns: ['Conta', 'Categoria', 'Vencimento', 'Situação', 'Valor Previsto'],
          rows: fixedBills.map((b) => {
            const st = getFixedBillStatusForMonth(b, currentMonth);
            return [
              b.name,
              b.category,
              `Dia ${b.dueDay}`,
              st.label,
              b.expectedAmount,
            ];
          }),
          sheetName: 'ContasFixas',
          fileNameBase: 'relatorio_contas_fixas',
        };
      }
      case 'economia': {
        const totalSaved = reserves.reduce((s, r) => s + r.currentAmount, 0);
        const deposits = periodResMovements
          .filter((m) => m.type === 'deposito')
          .reduce((s, m) => s + m.amount, 0);
        const withdrawals = periodResMovements
          .filter((m) => m.type === 'retirada')
          .reduce((s, m) => s + m.amount, 0);
        return {
          title: 'Relatório de Economia e Reserva',
          subtitle: 'Evolução das metas do Nosso Cofrinho',
          familyName,
          periodLabel,
          summaryRows: [
            { label: 'Saldo acumulado total', value: formatBRL(totalSaved) },
            { label: 'Depósitos no período', value: formatBRL(deposits) },
            { label: 'Retiradas no período', value: formatBRL(withdrawals) },
          ],
          columns: ['Data', 'Meta', 'Tipo', 'Responsável', 'Valor'],
          rows: periodResMovements.map((m) => [
            formatDateBR(m.date),
            m.goalName,
            m.type === 'deposito' ? 'Depósito' : 'Retirada',
            m.createdByName,
            m.amount,
          ]),
          sheetName: 'Economia',
          fileNameBase: 'relatorio_economia',
        };
      }
      case 'por_categoria':
        return {
          title: 'Relatório de Despesas por Categoria',
          subtitle: 'Distribuição percentual e valores gastos por categoria',
          familyName,
          periodLabel,
          summaryRows: [{ label: 'Total de despesas no período', value: formatBRL(sumExp) }],
          columns: ['Categoria', 'Participação %', 'Total Gasto'],
          rows: categoryBreakdown.map((c) => [
            c.category,
            `${c.percent.toFixed(1).replace('.', ',')}%`,
            c.amount,
          ]),
          sheetName: 'PorCategoria',
          fileNameBase: 'relatorio_por_categoria',
        };
      case 'por_integrante': {
        const map = new Map<string, { incomes: number; expenses: number }>();
        for (const i of periodIncomes) {
          const cur = map.get(i.responsibleName) ?? { incomes: 0, expenses: 0 };
          cur.incomes += i.amount;
          map.set(i.responsibleName, cur);
        }
        for (const e of periodExpenses) {
          const cur = map.get(e.responsibleName) ?? { incomes: 0, expenses: 0 };
          cur.expenses += e.amount;
          map.set(e.responsibleName, cur);
        }
        const entries = Array.from(map.entries());
        return {
          title: 'Relatório por Integrante da Família',
          subtitle: 'Receitas e despesas agrupadas por responsável',
          familyName,
          periodLabel,
          summaryRows: [
            { label: 'Integrantes com movimentação', value: String(entries.length) },
            { label: 'Total Receitas', value: formatBRL(sumInc) },
            { label: 'Total Despesas', value: formatBRL(sumExp) },
          ],
          columns: ['Integrante', 'Receitas', 'Despesas', 'Saldo Líquido'],
          rows: entries.map(([name, val]) => [
            name,
            val.incomes,
            val.expenses,
            val.incomes - val.expenses,
          ]),
          sheetName: 'PorIntegrante',
          fileNameBase: 'relatorio_por_integrante',
        };
      }
    }
  }, [
    reportType,
    family,
    filter,
    periodIncomes,
    periodExpenses,
    periodResMovements,
    monthlySeries,
    categoryBreakdown,
    debts,
    fixedBills,
    reserves,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Relatórios Financeiros</h1>
          <p className="text-sm text-slate-600">
            Gere análises completas por período e exporte em PDF ou Excel para guardar ou
            compartilhar.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => exportReportToPDF(reportPayload)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-xs sm:text-sm font-semibold hover:bg-[#14533F] cursor-pointer whitespace-nowrap"
          >
            <FileText className="w-4 h-4" />
            Exportar PDF
          </button>
          <button
            type="button"
            onClick={() => exportReportToExcel(reportPayload)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-semibold hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#15803D]" />
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Report Type Selector + Period */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt.id}
              type="button"
              onClick={() => setReportType(rt.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                reportType === rt.id
                  ? 'bg-[#0D3B2E] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {rt.label}
            </button>
          ))}
        </div>

        {reportType !== 'anual' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
            <span className="font-medium text-slate-600">Período:</span>
            {(
              [
                { key: 'mes_atual', label: 'Mês atual' },
                { key: 'mes_anterior', label: 'Mês anterior' },
                { key: 'ultimos_3_meses', label: '3 meses' },
                { key: 'ultimos_6_meses', label: '6 meses' },
                { key: 'ano_atual', label: 'Ano atual' },
                { key: 'personalizado', label: 'Personalizado' },
              ] as { key: PeriodFilterKey; label: string }[]
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPeriodKey(opt.key)}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  periodKey === opt.key
                    ? 'bg-[#E8F5EE] text-[#0D3B2E]'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}

            {periodKey === 'personalizado' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2 py-1 rounded-md border border-slate-300"
                />
                <span>a</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2 py-1 rounded-md border border-slate-300"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {reportPayload.summaryRows.map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="text-xl font-bold font-mono-num text-slate-900 mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Visual Charts inside Reports */}
      {(reportType === 'mensal' || reportType === 'anual') && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900">Gráfico do período</h2>
          <GroupedBarChart data={monthlySeries} />
        </div>
      )}

      {(reportType === 'por_categoria' || reportType === 'despesas') && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900">Distribuição por categoria</h2>
          <DonutCategoryChart items={categoryBreakdown} />
        </div>
      )}

      {/* Report Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{reportPayload.title}</h2>
            <p className="text-xs text-slate-500">
              {reportPayload.subtitle} · {reportPayload.periodLabel}
            </p>
          </div>
        </div>

        {reportPayload.rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Nenhum dado disponível para este relatório no período selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  {reportPayload.columns.map((col) => (
                    <th key={col} className="py-3 px-4 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {reportPayload.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className={`py-3 px-4 whitespace-nowrap ${
                          typeof cell === 'number'
                            ? 'font-mono-num font-semibold text-slate-900'
                            : 'text-slate-700'
                        }`}
                      >
                        {typeof cell === 'number' ? formatBRL(cell) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
