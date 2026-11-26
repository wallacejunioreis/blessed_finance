import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Landmark,
  PiggyBank,
  Plus,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { AppRoute, PeriodFilterKey } from '../types/finance';
import {
  buildExpenseByCategory,
  buildMonthlyChartSeries,
  buildPeriodFilter,
  computeDashboardKPIs,
  getFixedBillStatusForMonth,
} from '../utils/financeCalculations';
import { formatBRL, formatDateBR, formatPercent, getCurrentMonthBrazil } from '../utils/formatters';
import {
  AreaTrendChart,
  DonutCategoryChart,
  GroupedBarChart,
  NetComparisonChart,
} from './Charts';

interface DashboardViewProps {
  onNavigate: (route: AppRoute) => void;
  onQuickAdd: (type: 'despesa' | 'receita') => void;
}

const PERIOD_OPTIONS: { key: PeriodFilterKey; label: string }[] = [
  { key: 'mes_atual', label: 'Mês atual' },
  { key: 'mes_anterior', label: 'Mês anterior' },
  { key: 'ultimos_3_meses', label: 'Últimos 3 meses' },
  { key: 'ultimos_6_meses', label: 'Últimos 6 meses' },
  { key: 'ano_atual', label: 'Ano atual' },
  { key: 'personalizado', label: 'Personalizado' },
];

export function DashboardView({ onNavigate, onQuickAdd }: DashboardViewProps) {
  const { family, members } = useAuth();
  const {
    loading,
    incomes,
    expenses,
    fixedBills,
    debts,
    debtPayments,
    reserves,
    reserveMovements,
  } = useFinance();

  const [periodKey, setPeriodKey] = useState<PeriodFilterKey>('mes_atual');
  const [customStart, setCustomStart] = useState(`${getCurrentMonthBrazil()}-01`);
  const [customEnd, setCustomEnd] = useState(
    buildPeriodFilter('mes_atual').endDate
  );

  const filter = useMemo(
    () => buildPeriodFilter(periodKey, customStart, customEnd),
    [periodKey, customStart, customEnd]
  );

  const kpis = useMemo(
    () =>
      computeDashboardKPIs({
        incomes,
        expenses,
        debts,
        reserves,
        reserveMovements,
        fixedBills,
        filter,
      }),
    [incomes, expenses, debts, reserves, reserveMovements, fixedBills, filter]
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

  const currentMonth = getCurrentMonthBrazil();
  const urgentBills = useMemo(
    () =>
      fixedBills
        .filter((b) => b.active)
        .map((b) => ({ bill: b, status: getFixedBillStatusForMonth(b, currentMonth) }))
        .filter((item) => item.status.status === 'vencida' || item.status.status === 'proxima'),
    [fixedBills, currentMonth]
  );

  const kpiCards = [
    {
      label: 'Saldo disponível',
      value: formatBRL(kpis.availableBalance),
      helper: 'Acumulado líquido no período',
      positive: kpis.availableBalance >= 0,
      icon: Wallet,
    },
    {
      label: 'Receitas do período',
      value: formatBRL(kpis.periodIncomes),
      helper: 'Entradas registradas',
      positive: true,
      icon: ArrowUpRight,
    },
    {
      label: 'Despesas do período',
      value: formatBRL(kpis.periodExpenses),
      helper: 'Saídas registradas',
      positive: kpis.periodExpenses === 0,
      icon: ArrowDownRight,
    },
    {
      label: 'Dívidas pendentes',
      value: formatBRL(kpis.totalPendingDebts),
      helper: 'Saldo devedor atual',
      positive: kpis.totalPendingDebts === 0,
      icon: Landmark,
    },
    {
      label: 'Reserva financeira',
      value: formatBRL(kpis.totalReserve),
      helper: 'Total no Nosso Cofrinho',
      positive: true,
      icon: PiggyBank,
    },
    {
      label: 'Disponível para gastar',
      value: formatBRL(kpis.availableToSpend),
      helper: 'Após contas fixas e reserva',
      positive: kpis.availableToSpend >= 0,
      icon: TrendingUp,
    },
    {
      label: 'Renda comprometida',
      value: formatPercent(kpis.committedIncomePercent),
      helper: 'Despesas + parcelas de dívidas',
      positive: kpis.committedIncomePercent <= 75,
      icon: CalendarClock,
    },
    {
      label: 'Economia no período',
      value: formatBRL(kpis.periodSavings),
      helper: 'Receitas menos despesas',
      positive: kpis.periodSavings >= 0,
      icon: PiggyBank,
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-24 bg-white border border-slate-200 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="h-28 bg-white border border-slate-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome & Purpose Banner */}
      <section className="bg-[#0D3B2E] text-white rounded-xl p-6 sm:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#E6C778]">
            <span>{family?.name || 'Nossa Família'}</span>
            <span aria-hidden="true">·</span>
            <span>
              {members.length} {members.length === 1 ? 'integrante ativo' : 'integrantes ativos'}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold leading-snug text-balance">
            Uma família organizada financeiramente constrói um futuro mais tranquilo.
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100/85 leading-relaxed">
            “Deus abençoe nossa casa, nossa família e a maneira como administramos aquilo que chega
            às nossas mãos. Cada pequena economia é um passo para um futuro melhor.”
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onQuickAdd('receita')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white text-xs sm:text-sm font-semibold hover:bg-white/20 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Nova receita
          </button>
          <button
            type="button"
            onClick={() => onQuickAdd('despesa')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#C89B3C] text-[#0D3B2E] text-xs sm:text-sm font-bold hover:bg-[#D4AF37] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Registrar despesa
          </button>
        </div>
      </section>

      {/* Urgent Bills Alert Strip */}
      {urgentBills.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-950">
              <p className="font-semibold">
                {urgentBills.length} conta{urgentBills.length > 1 ? 's' : ''} fixa
                {urgentBills.length > 1 ? 's' : ''} requer{urgentBills.length > 1 ? 'em' : ''}{' '}
                atenção neste mês
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                {urgentBills
                  .slice(0, 3)
                  .map((u) => `${u.bill.name} (${u.status.label})`)
                  .join(' · ')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('contas_fixas')}
            className="px-3.5 py-2 rounded-lg bg-amber-900 text-white text-xs font-semibold hover:bg-amber-800 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-center"
          >
            Ver Contas Fixas
          </button>
        </section>
      )}

      {/* Period Filters */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setPeriodKey(opt.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                periodKey === opt.key
                  ? 'bg-[#0D3B2E] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {periodKey === 'personalizado' ? (
            <>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
              <span>até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
            </>
          ) : (
            <span className="font-mono-num">
              Período: {formatDateBR(filter.startDate)} até {formatDateBR(filter.endDate)}
            </span>
          )}
        </div>
      </section>

      {/* 8 Main Indicators */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">{card.label}</span>
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    card.positive
                      ? 'bg-[#E8F5EE] text-[#0D3B2E]'
                      : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div>
                <p
                  className={`text-xl font-bold font-mono-num ${
                    card.positive ? 'text-slate-900' : 'text-red-700'
                  }`}
                >
                  {card.value}
                </p>
                <p className="text-xs text-slate-500 mt-1">{card.helper}</p>
              </div>
            </div>
          );
        })}
      </section>

      {/* Charts Grid (7 Required Charts) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Receitas vs Despesas */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Receitas versus despesas</h2>
            <p className="text-xs text-slate-500">
              Comparativo mensal entre entradas e saídas da família
            </p>
          </div>
          <GroupedBarChart data={monthlySeries} />
        </div>

        {/* 2. Gastos por Categoria */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Gastos por categoria</h2>
            <p className="text-xs text-slate-500">
              Distribuição das despesas no período selecionado
            </p>
          </div>
          <DonutCategoryChart items={categoryBreakdown} />
        </div>

        {/* 3. Evolução das Despesas */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Evolução das despesas</h2>
            <p className="text-xs text-slate-500">Acompanhamento mensal dos gastos familiares</p>
          </div>
          <AreaTrendChart
            data={monthlySeries}
            valueKey="expenses"
            color="#0D3B2E"
            fillColor="rgba(13, 59, 46, 0.12)"
            seriesLabel="Despesas"
            emptyMessage="Nenhuma despesa registrada neste intervalo."
          />
        </div>

        {/* 4. Evolução das Receitas */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Evolução das receitas</h2>
            <p className="text-xs text-slate-500">Crescimento e estabilidade das entradas</p>
          </div>
          <AreaTrendChart
            data={monthlySeries}
            valueKey="incomes"
            color="#16A34A"
            fillColor="rgba(22, 163, 74, 0.12)"
            seriesLabel="Receitas"
            emptyMessage="Nenhuma receita registrada neste intervalo."
          />
        </div>

        {/* 5. Evolução da Reserva Financeira */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Evolução da reserva financeira</h2>
            <p className="text-xs text-slate-500">Acumulado no Nosso Cofrinho ao longo dos meses</p>
          </div>
          <AreaTrendChart
            data={monthlySeries}
            valueKey="reserveCumulative"
            color="#C89B3C"
            fillColor="rgba(200, 155, 60, 0.16)"
            seriesLabel="Reserva acumulada"
            emptyMessage="Registre depósitos no Nosso Cofrinho para acompanhar a evolução."
          />
        </div>

        {/* 6. Comparação entre Meses */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Comparação entre meses</h2>
            <p className="text-xs text-slate-500">Resultado líquido mensal (economia ou déficit)</p>
          </div>
          <NetComparisonChart data={monthlySeries} />
        </div>
      </section>

      {/* 7. Evolução do Pagamento das Dívidas */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Evolução do pagamento das dívidas
            </h2>
            <p className="text-xs text-slate-500">
              Total acumulado amortizado pela família ao longo dos meses
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('dividas')}
            className="text-xs font-semibold text-[#0D3B2E] hover:underline cursor-pointer"
          >
            Gerenciar dívidas
          </button>
        </div>
        <AreaTrendChart
          data={monthlySeries}
          valueKey="debtPaidCumulative"
          color="#1F6F54"
          fillColor="rgba(31, 111, 84, 0.14)"
          seriesLabel="Total pago em dívidas"
          emptyMessage="Registre pagamentos na aba Minhas Dívidas para visualizar o avanço."
        />
      </section>
    </div>
  );
}
