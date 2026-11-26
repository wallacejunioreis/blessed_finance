import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Target, Trash2 } from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { PLANNING_CATEGORIES } from '../types/finance';
import { formatBRL, getCurrentMonthBrazil, getMonthLongLabelBR } from '../utils/formatters';

interface PlanningViewProps {
  onNotify: (msg: string) => void;
}

const SUGGESTED_STARTER_LIMITS: { category: string; limit: number }[] = [
  { category: 'Supermercado', limit: 800 },
  { category: 'Carne', limit: 400 },
  { category: 'Energia elétrica', limit: 180 },
  { category: 'Água', limit: 100 },
  { category: 'Internet', limit: 120 },
  { category: 'Telefone', limit: 80 },
  { category: 'Transporte', limit: 300 },
  { category: 'Lazer', limit: 150 },
  { category: 'Reserva', limit: 300 },
];

export function PlanningView({ onNotify }: PlanningViewProps) {
  const { budgets, expenses, reserveMovements, saveBudget, deleteBudget } = useFinance();

  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthBrazil());
  const [newCategory, setNewCategory] = useState(PLANNING_CATEGORIES[0]);
  const [newLimit, setNewLimit] = useState('');
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const monthExpenses = useMemo(
    () => expenses.filter((e) => e.date.slice(0, 7) === selectedMonth),
    [expenses, selectedMonth]
  );

  const monthReserveDeposits = useMemo(
    () =>
      reserveMovements
        .filter((m) => m.type === 'deposito' && m.date.slice(0, 7) === selectedMonth)
        .reduce((s, m) => s + m.amount, 0),
    [reserveMovements, selectedMonth]
  );

  const rows = useMemo(() => {
    return budgets.map((b) => {
      const catLower = b.category.toLowerCase();
      const spent =
        catLower === 'reserva'
          ? monthReserveDeposits
          : monthExpenses
              .filter(
                (e) =>
                  e.category.toLowerCase() === catLower ||
                  e.subcategory.toLowerCase() === catLower
              )
              .reduce((s, e) => s + e.amount, 0);

      const remaining = b.monthlyLimit - spent;
      const pct = b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0;

      let alertLevel: 'normal' | 'atencao' | 'critico' | 'excedido' = 'normal';
      let alertLabel = 'Dentro do planejado';
      if (pct >= 100) {
        alertLevel = 'excedido';
        alertLabel = 'Limite ultrapassado';
      } else if (pct >= 90) {
        alertLevel = 'critico';
        alertLabel = 'Atingiu 90% do limite';
      } else if (pct >= 70) {
        alertLevel = 'atencao';
        alertLabel = 'Atingiu 70% do limite';
      }

      return { budget: b, spent, remaining, pct, alertLevel, alertLabel };
    });
  }, [budgets, monthExpenses, monthReserveDeposits]);

  const totalPlanned = useMemo(() => rows.reduce((s, r) => s + r.budget.monthlyLimit, 0), [rows]);
  const totalSpent = useMemo(() => rows.reduce((s, r) => s + r.spent, 0), [rows]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(newLimit.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) return;
    setBusyId('new');
    try {
      const existing = budgets.find(
        (b) => b.category.toLowerCase() === newCategory.toLowerCase()
      );
      await saveBudget({
        category: newCategory,
        monthlyLimit: num,
        existingId: existing?.id,
      });
      setNewLimit('');
      onNotify(`Limite de ${newCategory} salvo.`);
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyStarterSuggestions = async () => {
    setBusyId('starter');
    try {
      for (const item of SUGGESTED_STARTER_LIMITS) {
        const exists = budgets.some(
          (b) => b.category.toLowerCase() === item.category.toLowerCase()
        );
        if (!exists) {
          await saveBudget({ category: item.category, monthlyLimit: item.limit });
        }
      }
      onNotify('Limites base adicionados! Você pode editar qualquer valor livremente.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Planejamento Financeiro Mensal</h1>
          <p className="text-sm text-slate-600">
            Estabeleçam limites editáveis por categoria e recebam alertas em 70%, 90% e 100%.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-600">Mês:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">
            Total planejado ({getMonthLongLabelBR(selectedMonth)})
          </p>
          <p className="text-xl font-bold font-mono-num text-slate-900 mt-1">
            {formatBRL(totalPlanned)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total já utilizado</p>
          <p className="text-xl font-bold font-mono-num text-slate-900 mt-1">
            {formatBRL(totalSpent)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Saldo restante do orçamento</p>
          <p
            className={`text-xl font-bold font-mono-num mt-1 ${
              totalPlanned - totalSpent >= 0 ? 'text-[#15803D]' : 'text-red-700'
            }`}
          >
            {formatBRL(totalPlanned - totalSpent)}
          </p>
        </div>
      </div>

      {/* Add Category Budget */}
      <form
        onSubmit={handleAdd}
        className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-end gap-3"
      >
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Categoria ou subcategoria
          </label>
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
          >
            {PLANNING_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Limite mensal (R$)
          </label>
          <input
            type="number"
            step="0.01"
            min="1"
            required
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            placeholder="Ex.: 800,00"
            className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
          />
        </div>
        <button
          type="submit"
          disabled={busyId === 'new'}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Definir limite
        </button>
      </form>

      {/* Budget Cards */}
      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <div className="w-11 h-11 rounded-xl bg-[#E8F5EE] text-[#0D3B2E] flex items-center justify-center mx-auto">
            <Target className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">
              Nenhum limite definido no planejamento
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Defina seus próprios tetos de gastos acima ou comece com o modelo editável de
              categorias essenciais (Supermercado, Carne, Energia, Água, Internet, Transporte,
              Lazer e Reserva).
            </p>
          </div>
          <button
            type="button"
            disabled={busyId === 'starter'}
            onClick={handleApplyStarterSuggestions}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0D3B2E] text-[#0D3B2E] text-xs font-semibold hover:bg-[#E8F5EE] cursor-pointer"
          >
            Carregar modelo editável de categorias
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map(({ budget, spent, remaining, pct, alertLevel, alertLabel }) => {
            const editVal = editingValues[budget.id] ?? String(budget.monthlyLimit);
            const isModified =
              Number(editVal.replace(',', '.')) !== budget.monthlyLimit &&
              Number(editVal.replace(',', '.')) > 0;

            return (
              <div
                key={budget.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{budget.category}</h3>
                    <div
                      className={`inline-flex items-center gap-1.5 text-xs font-medium mt-1 ${
                        alertLevel === 'excedido'
                          ? 'text-red-700'
                          : alertLevel === 'critico'
                          ? 'text-red-700'
                          : alertLevel === 'atencao'
                          ? 'text-amber-700'
                          : 'text-[#15803D]'
                      }`}
                    >
                      {alertLevel === 'normal' ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      )}
                      <span>{alertLabel}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => deleteBudget(budget)}
                    aria-label="Remover limite"
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-600 font-mono-num">
                    <span>Gasto: {formatBRL(spent)}</span>
                    <span className="font-semibold">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        alertLevel === 'excedido' || alertLevel === 'critico'
                          ? 'bg-red-600'
                          : alertLevel === 'atencao'
                          ? 'bg-amber-500'
                          : 'bg-[#16A34A]'
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 font-mono-num">
                    {remaining >= 0
                      ? `Restante: ${formatBRL(remaining)}`
                      : `Excedido em: ${formatBRL(Math.abs(remaining))}`}
                  </p>
                </div>

                {/* Inline editable limit */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <label className="text-xs text-slate-600 whitespace-nowrap">
                    Limite (R$):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editVal}
                    onChange={(e) =>
                      setEditingValues((prev) => ({ ...prev, [budget.id]: e.target.value }))
                    }
                    className="w-28 px-2.5 py-1 text-xs font-mono-num rounded-md border border-slate-300"
                  />
                  {isModified && (
                    <button
                      type="button"
                      disabled={busyId === budget.id}
                      onClick={async () => {
                        setBusyId(budget.id);
                        try {
                          await saveBudget({
                            category: budget.category,
                            monthlyLimit: Number(editVal.replace(',', '.')),
                            existingId: budget.id,
                          });
                          onNotify(`Limite de ${budget.category} atualizado.`);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="px-2.5 py-1 rounded-md bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer"
                    >
                      Salvar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
