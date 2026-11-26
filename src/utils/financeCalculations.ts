import {
  Budget,
  Debt,
  DebtPayment,
  Expense,
  FixedBill,
  Income,
  PeriodFilter,
  PeriodFilterKey,
  ReserveGoal,
  ReserveMovement,
} from '../types/finance';
import {
  formatBRL,
  getCurrentMonthBrazil,
  getLastDayOfMonth,
  getMonthShortLabelBR,
  getTodayBrazilISO,
  shiftMonth,
} from './formatters';

export function buildPeriodFilter(
  key: PeriodFilterKey,
  customStart?: string,
  customEnd?: string
): PeriodFilter {
  const currentMonth = getCurrentMonthBrazil();
  const today = getTodayBrazilISO();
  const year = currentMonth.slice(0, 4);

  switch (key) {
    case 'mes_atual':
      return {
        key,
        startDate: `${currentMonth}-01`,
        endDate: getLastDayOfMonth(currentMonth),
      };
    case 'mes_anterior': {
      const prev = shiftMonth(currentMonth, -1);
      return {
        key,
        startDate: `${prev}-01`,
        endDate: getLastDayOfMonth(prev),
      };
    }
    case 'ultimos_3_meses': {
      const start = shiftMonth(currentMonth, -2);
      return {
        key,
        startDate: `${start}-01`,
        endDate: getLastDayOfMonth(currentMonth),
      };
    }
    case 'ultimos_6_meses': {
      const start = shiftMonth(currentMonth, -5);
      return {
        key,
        startDate: `${start}-01`,
        endDate: getLastDayOfMonth(currentMonth),
      };
    }
    case 'ano_atual':
      return {
        key,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
      };
    case 'personalizado':
      return {
        key,
        startDate: customStart || `${currentMonth}-01`,
        endDate: customEnd || today,
      };
  }
}

export function isDateInPeriod(dateStr: string, filter: PeriodFilter): boolean {
  if (!dateStr) return false;
  return dateStr >= filter.startDate && dateStr <= filter.endDate;
}

export interface FixedBillComputedStatus {
  status: 'paga' | 'vencida' | 'proxima' | 'pendente';
  label: string;
  daysUntilDue: number;
  dueDateForMonth: string;
}

export function getFixedBillStatusForMonth(
  bill: FixedBill,
  referenceMonth: string = getCurrentMonthBrazil()
): FixedBillComputedStatus {
  const [yStr, mStr] = referenceMonth.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const maxDay = new Date(year, month, 0).getDate();
  const safeDueDay = Math.min(Math.max(bill.dueDay, 1), maxDay);
  const dueDateForMonth = `${referenceMonth}-${String(safeDueDay).padStart(2, '0')}`;

  if (bill.lastPaidMonth === referenceMonth) {
    return {
      status: 'paga',
      label: 'Paga neste mês',
      daysUntilDue: 0,
      dueDateForMonth,
    };
  }

  const todayISO = getTodayBrazilISO();
  const todayMs = new Date(`${todayISO}T12:00:00`).getTime();
  const dueMs = new Date(`${dueDateForMonth}T12:00:00`).getTime();
  const diffDays = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      status: 'vencida',
      label: `Vencida há ${Math.abs(diffDays)} dia${Math.abs(diffDays) === 1 ? '' : 's'}`,
      daysUntilDue: diffDays,
      dueDateForMonth,
    };
  }
  if (diffDays <= 5) {
    return {
      status: 'proxima',
      label: diffDays === 0 ? 'Vence hoje' : `Vence em ${diffDays} dia${diffDays === 1 ? '' : 's'}`,
      daysUntilDue: diffDays,
      dueDateForMonth,
    };
  }
  return {
    status: 'pendente',
    label: `Vence dia ${String(safeDueDay).padStart(2, '0')}`,
    daysUntilDue: diffDays,
    dueDateForMonth,
  };
}

export interface DashboardKPIs {
  availableBalance: number;
  periodIncomes: number;
  periodExpenses: number;
  totalPendingDebts: number;
  totalReserve: number;
  availableToSpend: number;
  committedIncomePercent: number;
  periodSavings: number;
  pendingBillsTotal: number;
}

export function computeDashboardKPIs(params: {
  incomes: Income[];
  expenses: Expense[];
  debts: Debt[];
  reserves: ReserveGoal[];
  reserveMovements: ReserveMovement[];
  fixedBills: FixedBill[];
  filter: PeriodFilter;
}): DashboardKPIs {
  const { incomes, expenses, debts, reserves, reserveMovements, fixedBills, filter } = params;

  const currentMonth = getCurrentMonthBrazil();

  const periodIncomes = incomes
    .filter((i) => isDateInPeriod(i.date, filter))
    .reduce((sum, i) => sum + i.amount, 0);

  const periodExpenses = expenses
    .filter((e) => isDateInPeriod(e.date, filter))
    .reduce((sum, e) => sum + e.amount, 0);

  // Accumulated balance up to filter.endDate (operational receipts minus expenses minus net reserve transfers)
  const totalIncomesUpToEnd = incomes
    .filter((i) => i.date <= filter.endDate)
    .reduce((sum, i) => sum + i.amount, 0);

  const totalPaidExpensesUpToEnd = expenses
    .filter((e) => e.date <= filter.endDate && e.status === 'pago')
    .reduce((sum, e) => sum + e.amount, 0);

  const netReserveUpToEnd = reserveMovements
    .filter((m) => m.date <= filter.endDate)
    .reduce((sum, m) => (m.type === 'deposito' ? sum + m.amount : sum - m.amount), 0);

  const availableBalance = totalIncomesUpToEnd - totalPaidExpensesUpToEnd - Math.max(0, netReserveUpToEnd);

  const totalPendingDebts = debts
    .filter((d) => d.status === 'ativa')
    .reduce((sum, d) => sum + d.currentAmount, 0);

  const totalReserve = reserves.reduce((sum, r) => sum + r.currentAmount, 0);

  const pendingBillsTotal = fixedBills
    .filter((b) => b.active && getFixedBillStatusForMonth(b, currentMonth).status !== 'paga')
    .reduce((sum, b) => sum + b.expectedAmount, 0);

  const plannedReserveMonthly = reserves.reduce((sum, r) => sum + r.monthlyContribution, 0);

  const activeDebtInstallmentsMonthly = debts
    .filter((d) => d.status === 'ativa')
    .reduce((sum, d) => sum + d.installmentAmount, 0);

  const periodSavings = periodIncomes - periodExpenses;
  const availableToSpend = periodIncomes - periodExpenses - pendingBillsTotal - plannedReserveMonthly;

  const committedTotal = periodExpenses + activeDebtInstallmentsMonthly;
  const committedIncomePercent =
    periodIncomes > 0 ? Math.min(Math.round((committedTotal / periodIncomes) * 1000) / 10, 999) : 0;

  return {
    availableBalance,
    periodIncomes,
    periodExpenses,
    totalPendingDebts,
    totalReserve,
    availableToSpend,
    committedIncomePercent,
    periodSavings,
    pendingBillsTotal,
  };
}

export interface MonthlySeriesPoint {
  month: string; // YYYY-MM
  label: string;
  incomes: number;
  expenses: number;
  net: number;
  reserveCumulative: number;
  debtPaidCumulative: number;
}

export function buildMonthlyChartSeries(params: {
  incomes: Income[];
  expenses: Expense[];
  reserveMovements: ReserveMovement[];
  debtPayments: DebtPayment[];
  filter: PeriodFilter;
}): MonthlySeriesPoint[] {
  const { incomes, expenses, reserveMovements, debtPayments, filter } = params;

  const startMonth = filter.startDate.slice(0, 7);
  const endMonth = filter.endDate.slice(0, 7);

  // Ensure at least 6 months of context if viewing a single month so trends are meaningful
  let iterStart = startMonth;
  if (startMonth === endMonth) {
    iterStart = shiftMonth(endMonth, -5);
  }

  const months: string[] = [];
  let cursor = iterStart;
  let guard = 0;
  while (cursor <= endMonth && guard < 24) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
    guard++;
  }

  let runningReserve = reserveMovements
    .filter((m) => m.date.slice(0, 7) < iterStart)
    .reduce((s, m) => (m.type === 'deposito' ? s + m.amount : s - m.amount), 0);

  let runningDebtPaid = debtPayments
    .filter((p) => p.date.slice(0, 7) < iterStart)
    .reduce((s, p) => s + p.amount, 0);

  return months.map((ym) => {
    const mInc = incomes
      .filter((i) => i.date.slice(0, 7) === ym)
      .reduce((s, i) => s + i.amount, 0);
    const mExp = expenses
      .filter((e) => e.date.slice(0, 7) === ym)
      .reduce((s, e) => s + e.amount, 0);
    const mRes = reserveMovements
      .filter((m) => m.date.slice(0, 7) === ym)
      .reduce((s, m) => (m.type === 'deposito' ? s + m.amount : s - m.amount), 0);
    const mDebt = debtPayments
      .filter((p) => p.date.slice(0, 7) === ym)
      .reduce((s, p) => s + p.amount, 0);

    runningReserve = Math.max(0, runningReserve + mRes);
    runningDebtPaid += mDebt;

    return {
      month: ym,
      label: getMonthShortLabelBR(ym),
      incomes: mInc,
      expenses: mExp,
      net: mInc - mExp,
      reserveCumulative: runningReserve,
      debtPaidCumulative: runningDebtPaid,
    };
  });
}

export interface CategoryBreakdownItem {
  category: string;
  amount: number;
  percent: number;
  color: string;
}

const CATEGORY_COLORS = [
  '#0D3B2E',
  '#1F6F54',
  '#C89B3C',
  '#2E8B57',
  '#52796F',
  '#84A98C',
  '#9A7B2C',
  '#475569',
];

export function buildExpenseByCategory(expenses: Expense[], filter: PeriodFilter): CategoryBreakdownItem[] {
  const filtered = expenses.filter((e) => isDateInPeriod(e.date, filter));
  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const map = new Map<string, number>();

  for (const exp of filtered) {
    map.set(exp.category, (map.get(exp.category) ?? 0) + exp.amount);
  }

  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount], index) => ({
      category,
      amount,
      percent: total > 0 ? (amount / total) * 100 : 0,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));
}

export interface FinancialInsight {
  id: string;
  type: 'alerta' | 'atencao' | 'positivo' | 'dica';
  area:
    | 'Compras'
    | 'Orçamento'
    | 'Contas Fixas'
    | 'Reserva'
    | 'Dívidas'
    | 'Planejamento';
  title: string;
  message: string;
}

export function generateFinancialInsights(params: {
  incomes: Income[];
  expenses: Expense[];
  fixedBills: FixedBill[];
  debts: Debt[];
  reserves: ReserveGoal[];
  budgets: Budget[];
}): FinancialInsight[] {
  const { incomes, expenses, fixedBills, debts, reserves, budgets } = params;
  const insights: FinancialInsight[] = [];

  const currentMonth = getCurrentMonthBrazil();
  const prevMonth = shiftMonth(currentMonth, -1);

  const curMonthExpenses = expenses.filter((e) => e.date.slice(0, 7) === currentMonth);
  const prevMonthExpenses = expenses.filter((e) => e.date.slice(0, 7) === prevMonth);

  // 1. Subcategory / Category comparison vs previous month (only real data)
  if (curMonthExpenses.length > 0 && prevMonthExpenses.length > 0) {
    const subCur = new Map<string, number>();
    const subPrev = new Map<string, number>();
    for (const e of curMonthExpenses) {
      subCur.set(e.subcategory, (subCur.get(e.subcategory) ?? 0) + e.amount);
    }
    for (const e of prevMonthExpenses) {
      subPrev.set(e.subcategory, (subPrev.get(e.subcategory) ?? 0) + e.amount);
    }

    for (const [sub, curAmt] of subCur.entries()) {
      const prevAmt = subPrev.get(sub) ?? 0;
      if (prevAmt > 0) {
        const diff = curAmt - prevAmt;
        const pct = Math.round((diff / prevAmt) * 100);
        if (diff >= 50 && pct >= 10) {
          insights.push({
            id: `sub-up-${sub}`,
            type: 'atencao',
            area: 'Compras',
            title: `Aumento em ${sub}`,
            message: `Vocês gastaram ${formatBRL(diff)} a mais com ${sub} em relação ao mês passado (aumento de ${pct}%). Vale revisar os itens da lista antes das próximas compras.`,
          });
        } else if (diff <= -50 && pct <= -10) {
          insights.push({
            id: `sub-down-${sub}`,
            type: 'positivo',
            area: 'Compras',
            title: `Economia em ${sub}`,
            message: `Parabéns! Os gastos com ${sub} caíram ${Math.abs(pct)}% (${formatBRL(Math.abs(diff))} a menos) em comparação ao mês passado.`,
          });
        }
      }
    }
  }

  // 2. Budget 70% / 90% / >100% alerts
  for (const budget of budgets) {
    if (budget.monthlyLimit <= 0) continue;
    if (budget.month !== 'padrao' && budget.month !== currentMonth) continue;

    const spent = curMonthExpenses
      .filter(
        (e) =>
          e.category.toLowerCase() === budget.category.toLowerCase() ||
          e.subcategory.toLowerCase() === budget.category.toLowerCase()
      )
      .reduce((s, e) => s + e.amount, 0);

    const pct = (spent / budget.monthlyLimit) * 100;
    if (pct >= 100) {
      insights.push({
        id: `budget-over-${budget.id}`,
        type: 'alerta',
        area: 'Orçamento',
        title: `Limite ultrapassado em ${budget.category}`,
        message: `O orçamento planejado de ${formatBRL(budget.monthlyLimit)} para ${budget.category} foi ultrapassado (gasto atual de ${formatBRL(spent)}, equivalente a ${pct.toFixed(0)}%).`,
      });
    } else if (pct >= 90) {
      insights.push({
        id: `budget-90-${budget.id}`,
        type: 'alerta',
        area: 'Orçamento',
        title: `Orçamento quase no limite: ${budget.category}`,
        message: `Vocês já utilizaram ${pct.toFixed(0)}% do orçamento de ${budget.category} (${formatBRL(spent)} de ${formatBRL(budget.monthlyLimit)}).`,
      });
    } else if (pct >= 70) {
      insights.push({
        id: `budget-70-${budget.id}`,
        type: 'atencao',
        area: 'Orçamento',
        title: `Atenção ao orçamento de ${budget.category}`,
        message: `Vocês atingiram ${pct.toFixed(0)}% do limite mensal de ${budget.category}. Ainda restam ${formatBRL(budget.monthlyLimit - spent)} disponíveis.`,
      });
    }
  }

  // 3. Fixed bills due soon or overdue
  const activeBills = fixedBills.filter((b) => b.active);
  const overdueBills = activeBills.filter(
    (b) => getFixedBillStatusForMonth(b, currentMonth).status === 'vencida'
  );
  const dueSoonBills = activeBills.filter(
    (b) => getFixedBillStatusForMonth(b, currentMonth).status === 'proxima'
  );

  if (overdueBills.length > 0) {
    const totalOverdue = overdueBills.reduce((s, b) => s + b.expectedAmount, 0);
    insights.push({
      id: 'bills-overdue',
      type: 'alerta',
      area: 'Contas Fixas',
      title: `${overdueBills.length} conta${overdueBills.length > 1 ? 's' : ''} vencida${overdueBills.length > 1 ? 's' : ''}`,
      message: `Existem ${overdueBills.length} conta(s) fixa(s) com vencimento ultrapassado neste mês, somando ${formatBRL(totalOverdue)} previstos. Priorize a regularização para evitar juros.`,
    });
  }

  if (dueSoonBills.length > 0) {
    const totalSoon = dueSoonBills.reduce((s, b) => s + b.expectedAmount, 0);
    insights.push({
      id: 'bills-due-soon',
      type: 'atencao',
      area: 'Contas Fixas',
      title: `${dueSoonBills.length} conta${dueSoonBills.length > 1 ? 's' : ''} próxima${dueSoonBills.length > 1 ? 's' : ''} do vencimento`,
      message: `Existem ${dueSoonBills.length} conta(s) com vencimento nos próximos 5 dias (${dueSoonBills.map((b) => b.name).join(', ')}), totalizando ${formatBRL(totalSoon)}.`,
    });
  }

  // 4. Debt prioritization insight (real debts)
  const activeDebts = debts.filter((d) => d.status === 'ativa' && d.currentAmount > 0);
  if (activeDebts.length > 0) {
    const highestInterest = [...activeDebts].sort((a, b) => b.interestRate - a.interestRate)[0];
    const smallestDebt = [...activeDebts].sort((a, b) => a.currentAmount - b.currentAmount)[0];
    if (highestInterest.interestRate > 0) {
      insights.push({
        id: 'debt-avalanche',
        type: 'dica',
        area: 'Dívidas',
        title: `Prioridade sugerida para quitar dívidas`,
        message: `A dívida "${highestInterest.name}" (${highestInterest.creditor}) possui a maior taxa de juros (${highestInterest.interestRate.toFixed(1).replace('.', ',')}% a.m.). Direcionar valores extras para ela reduz o custo total. Se preferir alívio rápido no orçamento mensal, "${smallestDebt.name}" tem o menor saldo restante (${formatBRL(smallestDebt.currentAmount)}).`,
      });
    }
  }

  // 5. Reserve & daily savings projection based on real income/expense
  const curIncomes = incomes
    .filter((i) => i.date.slice(0, 7) === currentMonth)
    .reduce((s, i) => s + i.amount, 0);
  const curExpensesTotal = curMonthExpenses.reduce((s, e) => s + e.amount, 0);
  const curMargin = curIncomes - curExpensesTotal;

  if (reserves.length === 0 && curIncomes > 0) {
    insights.push({
      id: 'reserve-start',
      type: 'dica',
      area: 'Reserva',
      title: 'Comece sua reserva familiar no Nosso Cofrinho',
      message: `Vocês já registraram ${formatBRL(curIncomes)} de receitas neste mês. Se separarem apenas R$ 10,00 por dia, poderão guardar aproximadamente R$ 300,00 em um mês de 30 dias.`,
    });
  } else if (reserves.length > 0) {
    const mainGoal = reserves[0];
    const remaining = Math.max(0, mainGoal.targetAmount - mainGoal.currentAmount);
    if (remaining > 0 && mainGoal.monthlyContribution > 0) {
      const monthsNeeded = Math.ceil(remaining / mainGoal.monthlyContribution);
      insights.push({
        id: 'reserve-projection',
        type: 'positivo',
        area: 'Reserva',
        title: `Projeção da meta "${mainGoal.name}"`,
        message: `Mantendo o depósito mensal planejado de ${formatBRL(mainGoal.monthlyContribution)}, vocês alcançarão os ${formatBRL(mainGoal.targetAmount)} em aproximadamente ${monthsNeeded} ${monthsNeeded === 1 ? 'mês' : 'meses'}.`,
      });
    }
  }

  if (curIncomes > 0 && curMargin > 0) {
    const savingsRate = (curMargin / curIncomes) * 100;
    insights.push({
      id: 'planning-margin',
      type: 'positivo',
      area: 'Planejamento',
      title: 'Saldo positivo no mês atual',
      message: `Até o momento, suas receitas superam as despesas em ${formatBRL(curMargin)} (${savingsRate.toFixed(1).replace('.', ',')}% da renda). Essa sobra pode fortalecer a reserva ou antecipar parcelas de dívidas.`,
    });
  } else if (curIncomes > 0 && curMargin < 0) {
    insights.push({
      id: 'planning-deficit',
      type: 'atencao',
      area: 'Planejamento',
      title: 'Despesas acima das receitas neste mês',
      message: `As despesas registradas neste mês superam as receitas em ${formatBRL(Math.abs(curMargin))}. Conversem juntos sobre quais compras podem ser adiadas para o próximo mês.`,
    });
  }

  return insights;
}

export type DebtStrategy = 'avalanche' | 'bola_de_neve' | 'vencimento';

export function sortDebtsByStrategy(debts: Debt[], strategy: DebtStrategy): Debt[] {
  const active = debts.filter((d) => d.status === 'ativa');
  return [...active].sort((a, b) => {
    if (strategy === 'avalanche') {
      if (b.interestRate !== a.interestRate) return b.interestRate - a.interestRate;
      return a.currentAmount - b.currentAmount;
    }
    if (strategy === 'bola_de_neve') {
      return a.currentAmount - b.currentAmount;
    }
    return a.dueDate.localeCompare(b.dueDate);
  });
}
