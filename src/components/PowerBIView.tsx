import { useMemo, useState } from 'react';
import {
  BarChart2,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  FileSpreadsheet,
  FilterX,
  Palette,
  Search,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import {
  POWERBI_DAX_MEASURES,
  downloadPowerBIDaxTxt,
  downloadPowerBIThemeJSON,
  exportPowerBIWorkbook,
} from '../utils/exportReports';
import {
  formatBRL,
  formatDateBR,
  formatPercent,
  getMonthShortLabelBR,
} from '../utils/formatters';

interface PowerBIViewProps {
  onNotify: (msg: string) => void;
}

export function PowerBIView({ onNotify }: PowerBIViewProps) {
  const { family } = useAuth();
  const { incomes, expenses, fixedBills, debts, reserves, budgets } = useFinance();

  // Slicers (Segmentações de dados)
  const [yearFilter, setYearFilter] = useState('todos');
  const [monthFilter, setMonthFilter] = useState('todos');
  const [responsibleFilter, setResponsibleFilter] = useState('todos');
  const [categoryFilter, setCategoryFilter] = useState('todos');
  const [paymentFilter, setPaymentFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'pago' | 'pendente'>('todos');
  const [searchText, setSearchText] = useState('');

  // Kit Power BI Desktop drawer
  const [showDaxGuide, setShowDaxGuide] = useState(false);
  const [copiedDax, setCopiedDax] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const i of incomes) if (i.date) set.add(i.date.slice(0, 4));
    for (const e of expenses) if (e.date) set.add(e.date.slice(0, 4));
    return Array.from(set).sort().reverse();
  }, [incomes, expenses]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const i of incomes) {
      if (i.date && (yearFilter === 'todos' || i.date.startsWith(yearFilter))) {
        set.add(i.date.slice(0, 7));
      }
    }
    for (const e of expenses) {
      if (e.date && (yearFilter === 'todos' || e.date.startsWith(yearFilter))) {
        set.add(e.date.slice(0, 7));
      }
    }
    return Array.from(set).sort().reverse();
  }, [incomes, expenses, yearFilter]);

  const responsibles = useMemo(() => {
    const set = new Set<string>();
    for (const i of incomes) if (i.responsibleName) set.add(i.responsibleName);
    for (const e of expenses) if (e.responsibleName) set.add(e.responsibleName);
    return Array.from(set).sort();
  }, [incomes, expenses]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of expenses) if (e.category) set.add(e.category);
    for (const i of incomes) if (i.category) set.add(i.category);
    return Array.from(set).sort();
  }, [incomes, expenses]);

  const paymentMethods = useMemo(() => {
    const set = new Set<string>();
    for (const e of expenses) if (e.paymentMethod) set.add(e.paymentMethod);
    return Array.from(set).sort();
  }, [expenses]);

  const activeFilterCount = [
    yearFilter !== 'todos',
    monthFilter !== 'todos',
    responsibleFilter !== 'todos',
    categoryFilter !== 'todos',
    paymentFilter !== 'todos',
    statusFilter !== 'todos',
    searchText.trim() !== '',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setYearFilter('todos');
    setMonthFilter('todos');
    setResponsibleFilter('todos');
    setCategoryFilter('todos');
    setPaymentFilter('todos');
    setStatusFilter('todos');
    setSearchText('');
  };

  const filteredIncomes = useMemo(() => {
    return incomes.filter((i) => {
      if (yearFilter !== 'todos' && !i.date.startsWith(yearFilter)) return false;
      if (monthFilter !== 'todos' && !i.date.startsWith(monthFilter)) return false;
      if (responsibleFilter !== 'todos' && i.responsibleName !== responsibleFilter) return false;
      if (categoryFilter !== 'todos' && i.category !== categoryFilter) return false;
      if (paymentFilter !== 'todos' && paymentFilter !== 'Recebimento') return false;
      if (statusFilter !== 'todos') return false;
      return true;
    });
  }, [incomes, yearFilter, monthFilter, responsibleFilter, categoryFilter, paymentFilter, statusFilter]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (yearFilter !== 'todos' && !e.date.startsWith(yearFilter)) return false;
      if (monthFilter !== 'todos' && !e.date.startsWith(monthFilter)) return false;
      if (responsibleFilter !== 'todos' && e.responsibleName !== responsibleFilter) return false;
      if (categoryFilter !== 'todos' && e.category !== categoryFilter) return false;
      if (paymentFilter !== 'todos' && e.paymentMethod !== paymentFilter) return false;
      if (statusFilter !== 'todos' && e.status !== statusFilter) return false;
      return true;
    });
  }, [expenses, yearFilter, monthFilter, responsibleFilter, categoryFilter, paymentFilter, statusFilter]);

  const totalIncomes = useMemo(
    () => filteredIncomes.reduce((s, i) => s + i.amount, 0),
    [filteredIncomes]
  );
  const totalExpenses = useMemo(
    () => filteredExpenses.reduce((s, e) => s + e.amount, 0),
    [filteredExpenses]
  );
  const netBalance = totalIncomes - totalExpenses;
  const savingsPct = totalIncomes > 0 ? (netBalance / totalIncomes) * 100 : 0;
  const totalActiveDebts = useMemo(
    () => debts.filter((d) => d.status === 'ativa').reduce((s, d) => s + d.currentAmount, 0),
    [debts]
  );
  const totalReserve = useMemo(
    () => reserves.reduce((s, r) => s + r.currentAmount, 0),
    [reserves]
  );

  // Visual 1: Monthly bars (respects year/responsible/category/payment/status, highlights selected month)
  const monthlyVisual = useMemo(() => {
    const map = new Map<string, { month: string; incomes: number; expenses: number }>();
    for (const i of incomes) {
      if (yearFilter !== 'todos' && !i.date.startsWith(yearFilter)) continue;
      if (responsibleFilter !== 'todos' && i.responsibleName !== responsibleFilter) continue;
      if (categoryFilter !== 'todos' && i.category !== categoryFilter) continue;
      if (paymentFilter !== 'todos' && paymentFilter !== 'Recebimento') continue;
      if (statusFilter !== 'todos') continue;
      const ym = i.date.slice(0, 7);
      const cur = map.get(ym) || { month: ym, incomes: 0, expenses: 0 };
      cur.incomes += i.amount;
      map.set(ym, cur);
    }
    for (const e of expenses) {
      if (yearFilter !== 'todos' && !e.date.startsWith(yearFilter)) continue;
      if (responsibleFilter !== 'todos' && e.responsibleName !== responsibleFilter) continue;
      if (categoryFilter !== 'todos' && e.category !== categoryFilter) continue;
      if (paymentFilter !== 'todos' && e.paymentMethod !== paymentFilter) continue;
      if (statusFilter !== 'todos' && e.status !== statusFilter) continue;
      const ym = e.date.slice(0, 7);
      const cur = map.get(ym) || { month: ym, incomes: 0, expenses: 0 };
      cur.expenses += e.amount;
      map.set(ym, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-8);
  }, [incomes, expenses, yearFilter, responsibleFilter, categoryFilter, paymentFilter, statusFilter]);

  // Visual 2: Expenses by category
  const categoryVisual = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredExpenses) {
      map.set(e.category, (map.get(e.category) || 0) + e.amount);
    }
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    return entries.map(([label, amount]) => ({
      label,
      amount,
      pct: total > 0 ? (amount / total) * 100 : 0,
    }));
  }, [filteredExpenses]);

  // Visual 3: Responsible breakdown (Expenses vs Incomes)
  const responsibleVisual = useMemo(() => {
    const map = new Map<string, { name: string; incomes: number; expenses: number }>();
    for (const i of filteredIncomes) {
      const cur = map.get(i.responsibleName) || {
        name: i.responsibleName,
        incomes: 0,
        expenses: 0,
      };
      cur.incomes += i.amount;
      map.set(i.responsibleName, cur);
    }
    for (const e of filteredExpenses) {
      const cur = map.get(e.responsibleName) || {
        name: e.responsibleName,
        incomes: 0,
        expenses: 0,
      };
      cur.expenses += e.amount;
      map.set(e.responsibleName, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.expenses + b.incomes - (a.expenses + a.incomes));
  }, [filteredIncomes, filteredExpenses]);

  // Visual 4: Payment methods breakdown
  const paymentVisual = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredExpenses) {
      map.set(e.paymentMethod, (map.get(e.paymentMethod) || 0) + e.amount);
    }
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    return entries.map(([label, amount]) => ({
      label,
      amount,
      pct: total > 0 ? (amount / total) * 100 : 0,
    }));
  }, [filteredExpenses]);

  // Matrix: Category x Budget x Actual
  const matrixRows = useMemo(() => {
    const budgetMap = new Map<string, number>();
    for (const b of budgets) {
      budgetMap.set(b.category, (budgetMap.get(b.category) || 0) + b.monthlyLimit);
    }
    const spentMap = new Map<string, { count: number; total: number }>();
    for (const e of filteredExpenses) {
      const cur = spentMap.get(e.category) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += e.amount;
      spentMap.set(e.category, cur);
    }
    const allCats = Array.from(new Set([...budgetMap.keys(), ...spentMap.keys()])).sort();
    return allCats
      .map((cat) => {
        const planned = budgetMap.get(cat) || 0;
        const spent = spentMap.get(cat)?.total || 0;
        const count = spentMap.get(cat)?.count || 0;
        const diff = planned > 0 ? planned - spent : 0;
        const pct = planned > 0 ? (spent / planned) * 100 : 0;
        return { category: cat, count, planned, spent, diff, pct };
      })
      .sort((a, b) => b.spent - a.spent);
  }, [budgets, filteredExpenses]);

  // Drill-through unified transactions table
  const drillRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = [
      ...filteredIncomes.map((i) => ({
        id: i.id,
        type: 'Receita' as const,
        date: i.date,
        description: i.description,
        category: i.category,
        subcategory: 'Entrada',
        paymentMethod: 'Recebimento',
        responsibleName: i.responsibleName,
        status: 'recebido',
        amount: i.amount,
      })),
      ...filteredExpenses.map((e) => ({
        id: e.id,
        type: 'Despesa' as const,
        date: e.date,
        description: e.description,
        category: e.category,
        subcategory: e.subcategory,
        paymentMethod: e.paymentMethod,
        responsibleName: e.responsibleName,
        status: e.status,
        amount: e.amount,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    if (!q) return list.slice(0, 60);
    return list
      .filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.subcategory.toLowerCase().includes(q) ||
          r.responsibleName.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [filteredIncomes, filteredExpenses, searchText]);

  const handleDownloadWorkbook = async () => {
    setExportingXlsx(true);
    try {
      await exportPowerBIWorkbook({
        familyName: family?.name || 'Minha Família',
        incomes,
        expenses,
        fixedBills,
        debts,
        reserves,
        budgets,
      });
      onNotify('Base modelo Power BI (.xlsx) baixada com tabelas Fato e Dimensão!');
    } finally {
      setExportingXlsx(false);
    }
  };

  const maxMonthlyBar = Math.max(
    100,
    ...monthlyVisual.flatMap((m) => [m.incomes, m.expenses])
  );

  return (
    <div className="space-y-6">
      {/* Header & Power BI Desktop Export Kit */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Power BI Local</h1>
            <span className="text-[11px] font-semibold text-[#9A7B2C] bg-[#FEF9EC] border border-[#E6C778] px-2 py-0.5 rounded">
              Uso local no PC
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            Painel analítico interativo com filtros cruzados e kit completo para abrir no Power BI
            Desktop do seu computador.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={exportingXlsx}
            onClick={handleDownloadWorkbook}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-xs sm:text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#E6C778]" />
            {exportingXlsx ? 'Gerando Excel...' : 'Baixar Base Power BI (.xlsx)'}
          </button>

          <button
            type="button"
            onClick={() => {
              downloadPowerBIThemeJSON();
              onNotify('Tema JSON do Blessed Finance baixado para Power BI Desktop.');
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Palette className="w-4 h-4 text-[#C89B3C]" />
            Tema (.json)
          </button>

          <button
            type="button"
            onClick={() => setShowDaxGuide((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Code2 className="w-4 h-4 text-[#0D3B2E]" />
            Medidas DAX & Guia PC
            {showDaxGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Power BI Desktop Local Setup & DAX Measures */}
      {showDaxGuide && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-3">
              <h2 className="text-base font-bold text-slate-900">
                Como usar no Power BI Desktop no seu PC
              </h2>
              <ol className="space-y-2.5 text-xs sm:text-sm text-slate-600 list-decimal pl-4 leading-relaxed">
                <li>
                  Clique em <strong className="text-slate-900">Baixar Base Power BI (.xlsx)</strong>{' '}
                  para salvar o modelo com as tabelas <code className="font-mono">Fato_*</code> e{' '}
                  <code className="font-mono">Dim_*</code> no seu computador.
                </li>
                <li>
                  Abra o <strong className="text-slate-900">Power BI Desktop</strong> no Windows,
                  clique em <strong className="text-slate-900">Obter dados → Pasta de Trabalho do Excel</strong> e marque as 7 abas.
                </li>
                <li>
                  Em <strong className="text-slate-900">Exibição → Temas → Procurar temas</strong>,
                  importe o arquivo <code className="font-mono">Blessed_Finance_Tema_PowerBI.json</code> para aplicar as cores do app.
                </li>
                <li>
                  Crie suas medidas usando o pacote DAX ao lado (Total Receitas, Total Despesas,
                  Saldo Líquido, Margem, Dívidas e Orçamento). Sempre que quiser atualizar, baixe um
                  novo Excel e clique em <strong className="text-slate-900">Atualizar</strong> no Power BI.
                </li>
              </ol>
            </div>

            <div className="lg:col-span-7 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Pacote de Medidas DAX Prontas
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(POWERBI_DAX_MEASURES);
                      setCopiedDax(true);
                      setTimeout(() => setCopiedDax(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {copiedDax ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedDax ? 'DAX copiado!' : 'Copiar medidas'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadPowerBIDaxTxt();
                      onNotify('Arquivo de medidas DAX (.txt) baixado.');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer"
                  >
                    Baixar .txt
                  </button>
                </div>
              </div>
              <pre className="bg-slate-900 text-emerald-100 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-60 leading-relaxed">
                {POWERBI_DAX_MEASURES}
              </pre>
            </div>
          </div>
        </section>
      )}

      {/* Power BI Slicers Panel (Segmentação de Dados) */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <BarChart2 className="w-4 h-4 text-[#0D3B2E]" />
            Segmentação de Dados (clique nos gráficos ou selecione abaixo para filtrar todo o painel)
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-[#0D3B2E] bg-[#E8F5EE] hover:bg-[#D4ECDF] cursor-pointer"
            >
              <FilterX className="w-3.5 h-3.5" />
              Limpar filtros ({activeFilterCount})
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Ano</label>
            <select
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setMonthFilter('todos');
              }}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todos os anos</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Mês</label>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todos os meses</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {getMonthShortLabelBR(m)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Responsável</label>
            <select
              value={responsibleFilter}
              onChange={(e) => setResponsibleFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todos</option>
              {responsibles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Categoria</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todas</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Forma de pagamento
            </label>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todas</option>
              {paymentMethods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'todos' | 'pago' | 'pendente')}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todos</option>
              <option value="pago">Pago</option>
              <option value="pendente">Pendente</option>
            </select>
          </div>
        </div>
      </section>

      {/* Power BI KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-[#16A34A]">
          <p className="text-[11px] font-medium text-slate-500">Receitas (Filtro)</p>
          <p className="text-lg font-bold text-[#15803D] font-mono-num mt-1">
            {formatBRL(totalIncomes)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">{filteredIncomes.length} registro(s)</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-[#0D3B2E]">
          <p className="text-[11px] font-medium text-slate-500">Despesas (Filtro)</p>
          <p className="text-lg font-bold text-slate-900 font-mono-num mt-1">
            {formatBRL(totalExpenses)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">{filteredExpenses.length} registro(s)</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-[#C89B3C]">
          <p className="text-[11px] font-medium text-slate-500">Saldo Líquido</p>
          <p
            className={`text-lg font-bold font-mono-num mt-1 ${
              netBalance >= 0 ? 'text-[#0D3B2E]' : 'text-red-700'
            }`}
          >
            {formatBRL(netBalance)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Receitas − Despesas</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-[#1F6F54]">
          <p className="text-[11px] font-medium text-slate-500">Margem de Economia</p>
          <p
            className={`text-lg font-bold font-mono-num mt-1 ${
              savingsPct >= 0 ? 'text-[#15803D]' : 'text-red-700'
            }`}
          >
            {formatPercent(savingsPct)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Sobre a receita filtrada</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-slate-400">
          <p className="text-[11px] font-medium text-slate-500">Dívidas Ativas</p>
          <p className="text-lg font-bold text-slate-900 font-mono-num mt-1">
            {formatBRL(totalActiveDebts)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Saldo devedor atual</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-[#C89B3C]">
          <p className="text-[11px] font-medium text-slate-500">Reserva Guardada</p>
          <p className="text-lg font-bold text-[#0D3B2E] font-mono-num mt-1">
            {formatBRL(totalReserve)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">{reserves.length} meta(s)</p>
        </div>
      </div>

      {/* Interactive Cross-Filtering Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Monthly Columns */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Receitas x Despesas por Mês (clique no mês para filtrar)
              </h2>
              <p className="text-xs text-slate-500">
                Comparativo mensal interativo estilo Power BI
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" /> Receitas
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#0D3B2E]" /> Despesas
              </span>
            </div>
          </div>

          {monthlyVisual.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-slate-500">
              Sem movimentações para os filtros selecionados.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5 items-end pt-4">
              {monthlyVisual.map((m) => {
                const isSelected = monthFilter === m.month;
                const incPct = Math.round((m.incomes / maxMonthlyBar) * 100);
                const expPct = Math.round((m.expenses / maxMonthlyBar) * 100);
                return (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => setMonthFilter(isSelected ? 'todos' : m.month)}
                    className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#0D3B2E] bg-[#E8F5EE]/70'
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <div className="h-36 w-full flex items-end justify-center gap-1.5">
                      <div
                        title={`Receitas: ${formatBRL(m.incomes)}`}
                        style={{ height: `${Math.max(4, incPct)}%` }}
                        className="w-4 rounded-t bg-[#16A34A] transition-all"
                      />
                      <div
                        title={`Despesas: ${formatBRL(m.expenses)}`}
                        style={{ height: `${Math.max(4, expPct)}%` }}
                        className="w-4 rounded-t bg-[#0D3B2E] transition-all"
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-[11px] font-semibold text-slate-800">
                        {getMonthShortLabelBR(m.month)}
                      </p>
                      <p className="text-[10px] font-mono-num text-slate-500">
                        {formatBRL(m.incomes - m.expenses)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Expenses by Category (Cross-filter) */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Despesas por Categoria (clique para filtrar)
            </h2>
            <p className="text-xs text-slate-500">Participação percentual sobre o total gasto</p>
          </div>

          {categoryVisual.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-slate-500">
              Nenhuma despesa para os filtros ativos.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {categoryVisual.map((c) => {
                const isSelected = categoryFilter === c.label;
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setCategoryFilter(isSelected ? 'todos' : c.label)}
                    className={`w-full text-left p-2 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#0D3B2E] bg-[#E8F5EE]/70'
                        : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-800 truncate">{c.label}</span>
                      <span className="font-mono-num text-slate-700 font-semibold shrink-0 ml-2">
                        {formatBRL(c.amount)} ({c.pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0D3B2E] rounded-full"
                        style={{ width: `${Math.max(3, c.pct)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Secondary Visuals: Responsible + Payment Methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Comparativo por Responsável (clique para filtrar)
            </h2>
            <p className="text-xs text-slate-500">Receitas e despesas por integrante da família</p>
          </div>

          {responsibleVisual.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">Sem dados disponíveis.</p>
          ) : (
            <div className="space-y-3">
              {responsibleVisual.map((r) => {
                const isSelected = responsibleFilter === r.name;
                const maxVal = Math.max(
                  1,
                  ...responsibleVisual.map((x) => Math.max(x.incomes, x.expenses))
                );
                return (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => setResponsibleFilter(isSelected ? 'todos' : r.name)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer space-y-2 ${
                      isSelected
                        ? 'border-[#0D3B2E] bg-[#E8F5EE]/70'
                        : 'border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
                      <span>{r.name}</span>
                      <span className="font-mono-num text-slate-600">
                        Receitas {formatBRL(r.incomes)} · Despesas {formatBRL(r.expenses)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#16A34A] rounded-full"
                          style={{ width: `${(r.incomes / maxVal) * 100}%` }}
                        />
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0D3B2E] rounded-full"
                          style={{ width: `${(r.expenses / maxVal) * 100}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Formas de Pagamento (clique para filtrar)
            </h2>
            <p className="text-xs text-slate-500">Distribuição das despesas por meio utilizado</p>
          </div>

          {paymentVisual.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">Sem despesas filtradas.</p>
          ) : (
            <div className="space-y-2.5">
              {paymentVisual.map((p) => {
                const isSelected = paymentFilter === p.label;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPaymentFilter(isSelected ? 'todos' : p.label)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#0D3B2E] bg-[#E8F5EE]/70'
                        : 'border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-800">{p.label}</span>
                      <span className="font-mono-num font-semibold text-slate-800">
                        {formatBRL(p.amount)} ({p.pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#C89B3C] rounded-full"
                        style={{ width: `${Math.max(3, p.pct)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Power BI Matrix: Category x Planned x Spent x Balance */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            Matriz Analítica: Orçado vs Realizado por Categoria
          </h2>
          <p className="text-xs text-slate-500">
            Consolidado comparando metas de orçamento com os gastos filtrados
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <th className="py-3 px-4 font-semibold">Categoria</th>
                <th className="py-3 px-4 font-semibold text-right">Qtd.</th>
                <th className="py-3 px-4 font-semibold text-right">Orçado Mensal</th>
                <th className="py-3 px-4 font-semibold text-right">Realizado</th>
                <th className="py-3 px-4 font-semibold text-right">Diferença</th>
                <th className="py-3 px-4 font-semibold text-right">Uso %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matrixRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs text-slate-500">
                    Nenhuma categoria para exibir.
                  </td>
                </tr>
              ) : (
                matrixRows.map((row) => (
                  <tr
                    key={row.category}
                    onClick={() =>
                      setCategoryFilter(
                        categoryFilter === row.category ? 'todos' : row.category
                      )
                    }
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="py-2.5 px-4 font-medium text-slate-900">{row.category}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-slate-600">
                      {row.count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-slate-700">
                      {row.planned > 0 ? formatBRL(row.planned) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-semibold text-slate-900">
                      {formatBRL(row.spent)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono-num font-semibold ${
                        row.planned === 0
                          ? 'text-slate-400'
                          : row.diff >= 0
                          ? 'text-[#15803D]'
                          : 'text-red-700'
                      }`}
                    >
                      {row.planned > 0 ? formatBRL(row.diff) : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-slate-700">
                      {row.planned > 0 ? `${row.pct.toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Drill-through Details Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Detalhamento dos Lançamentos Filtrados
            </h2>
            <p className="text-xs text-slate-500">
              Exibindo até 60 lançamentos mais recentes conforme a segmentação ativa
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar descrição ou pessoa..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-2.5 px-4 font-semibold">Data</th>
                <th className="py-2.5 px-4 font-semibold">Tipo</th>
                <th className="py-2.5 px-4 font-semibold">Descrição</th>
                <th className="py-2.5 px-4 font-semibold">Categoria</th>
                <th className="py-2.5 px-4 font-semibold">Pagamento</th>
                <th className="py-2.5 px-4 font-semibold">Responsável</th>
                <th className="py-2.5 px-4 font-semibold text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drillRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    Nenhum lançamento corresponde aos filtros aplicados.
                  </td>
                </tr>
              ) : (
                drillRows.map((row) => (
                  <tr key={`${row.type}-${row.id}`} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono-num text-slate-600 whitespace-nowrap">
                      {formatDateBR(row.date)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">
                      <span
                        className={
                          row.type === 'Receita' ? 'text-[#15803D]' : 'text-slate-800'
                        }
                      >
                        {row.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{row.description}</td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {row.category} · {row.subcategory}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{row.paymentMethod}</td>
                    <td className="py-2.5 px-4 text-slate-600">{row.responsibleName}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                        row.type === 'Receita' ? 'text-[#15803D]' : 'text-slate-900'
                      }`}
                    >
                      {row.type === 'Receita' ? '+' : '-'} {formatBRL(row.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
