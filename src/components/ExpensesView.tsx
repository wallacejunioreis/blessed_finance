import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import {
  EXPENSE_CATEGORIES,
  Expense,
  MAX_LENGTHS,
  PAYMENT_METHODS,
} from '../types/finance';
import { formatBRL, formatDateBR, getCurrentMonthBrazil, getTodayBrazilISO } from '../utils/formatters';
import { ConfirmDialog } from './ConfirmDialog';

interface ExpensesViewProps {
  onNotify: (msg: string) => void;
}

export function ExpensesView({ onNotify }: ExpensesViewProps) {
  const { members, profile } = useAuth();
  const { expenses, addExpense, updateExpense, toggleExpenseStatus, deleteExpense } =
    useFinance();

  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('todas');
  const [filterStatus, setFilterStatus] = useState<'todos' | 'pago' | 'pendente'>('todos');
  const [filterMonth, setFilterMonth] = useState(getCurrentMonthBrazil());

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0].label);
  const [subcategory, setSubcategory] = useState(EXPENSE_CATEGORIES[0].subcategories[0]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayBrazilISO());
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [responsibleName, setResponsibleName] = useState(profile?.displayName || '');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'pago' | 'pendente'>('pago');
  const [installments, setInstallments] = useState('1');
  const [isRecurring, setIsRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const selectedCatObj =
    EXPENSE_CATEGORIES.find((c) => c.label === category) || EXPENSE_CATEGORIES[0];

  const filtered = useMemo(() => {
    return expenses.filter((exp) => {
      if (filterMonth && exp.date.slice(0, 7) !== filterMonth) return false;
      if (filterCat !== 'todas' && exp.category !== filterCat) return false;
      if (filterStatus !== 'todos' && exp.status !== filterStatus) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          exp.description.toLowerCase().includes(q) ||
          exp.category.toLowerCase().includes(q) ||
          exp.subcategory.toLowerCase().includes(q) ||
          exp.responsibleName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [expenses, filterMonth, filterCat, filterStatus, search]);

  const totalFiltered = useMemo(
    () => filtered.reduce((s, e) => s + e.amount, 0),
    [filtered]
  );

  const openCreate = () => {
    setEditing(null);
    setDescription('');
    setCategory(EXPENSE_CATEGORIES[0].label);
    setSubcategory(EXPENSE_CATEGORIES[0].subcategories[0]);
    setAmount('');
    setDate(getTodayBrazilISO());
    setPaymentMethod(PAYMENT_METHODS[0]);
    setResponsibleName(profile?.displayName || members[0]?.displayName || '');
    setNotes('');
    setStatus('pago');
    setInstallments('1');
    setIsRecurring(false);
    setErrorMsg('');
    setShowForm(true);
  };

  const openEdit = (exp: Expense) => {
    setEditing(exp);
    setDescription(exp.description);
    setCategory(exp.category);
    setSubcategory(exp.subcategory);
    setAmount(String(exp.amount));
    setDate(exp.date);
    setPaymentMethod(exp.paymentMethod);
    setResponsibleName(exp.responsibleName);
    setNotes(exp.notes || '');
    setStatus(exp.status);
    setInstallments('1');
    setIsRecurring(exp.isRecurring);
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const num = Number(amount.replace(',', '.'));
    if (!description.trim() || !Number.isFinite(num) || num <= 0) {
      setErrorMsg('Preencha descrição e valor válido maior que zero.');
      return;
    }

    setBusy(true);
    try {
      const respMember = members.find((m) => m.displayName === responsibleName);
      if (editing) {
        await updateExpense(editing.id, {
          description: description.trim(),
          category,
          subcategory,
          amount: num,
          date,
          paymentMethod,
          responsibleName: responsibleName || profile?.displayName || 'Integrante',
          responsibleUid: respMember?.uid,
          notes,
          status,
        });
        onNotify('Despesa atualizada com sucesso.');
      } else {
        await addExpense({
          description: description.trim(),
          category,
          subcategory,
          amount: num,
          date,
          paymentMethod,
          responsibleName: responsibleName || profile?.displayName || 'Integrante',
          responsibleUid: respMember?.uid,
          notes,
          status,
          installments: Math.max(1, Number(installments) || 1),
          isRecurring,
        });
        onNotify('Despesa cadastrada com sucesso.');
      }
      setShowForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar despesa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Despesas</h1>
          <p className="text-sm text-slate-600">
            Organize os gastos por categoria, subcategoria, parcelas e forma de pagamento.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Nova despesa
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Buscar</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Descrição ou item"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Mês</label>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
            />
            {filterMonth && (
              <button
                type="button"
                onClick={() => setFilterMonth('')}
                className="text-xs text-slate-500 hover:text-slate-900 whitespace-nowrap cursor-pointer"
              >
                Todos
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Categoria</label>
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
          >
            <option value="todas">Todas as categorias</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.code} value={c.label}>
                {c.code}. {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'todos' | 'pago' | 'pendente')}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
          >
            <option value="todos">Todos</option>
            <option value="pago">Pago</option>
            <option value="pendente">Pendente</option>
          </select>
        </div>

        <div className="bg-slate-100 rounded-lg px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">Total filtrado</span>
          <span className="text-base font-bold font-mono-num text-slate-900">
            {formatBRL(totalFiltered)}
          </span>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            {editing ? 'Editar despesa' : 'Cadastrar nova despesa'}
          </h2>
          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.description}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: Compra do mês"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {!editing && Number(installments) > 1 ? 'Valor total (R$)' : 'Valor (R$)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Data</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Categoria</label>
                <select
                  value={category}
                  onChange={(e) => {
                    const nextCat = e.target.value;
                    setCategory(nextCat);
                    const found = EXPENSE_CATEGORIES.find((c) => c.label === nextCat);
                    if (found) setSubcategory(found.subcategories[0]);
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.code} value={c.label}>
                      {c.code}. {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subcategoria
                </label>
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {selectedCatObj.subcategories.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Forma de pagamento
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {PAYMENT_METHODS.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Responsável</label>
                <select
                  value={responsibleName}
                  onChange={(e) => setResponsibleName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {members.length > 0 ? (
                    members.map((m) => (
                      <option key={m.uid} value={m.displayName}>
                        {m.displayName}
                      </option>
                    ))
                  ) : (
                    <option value={profile?.displayName || 'Integrante'}>
                      {profile?.displayName || 'Integrante'}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Status de pagamento
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'pago' | 'pendente')}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="pago">Pago</option>
                  <option value="pendente">Pendente</option>
                </select>
              </div>

              {!editing && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Número de parcelas
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={installments}
                    onChange={(e) => setInstallments(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                  />
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4 items-center">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Observações
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.notes}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalhes opcionais"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              {!editing && (
                <label className="flex items-center gap-2 text-xs text-slate-700 pt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="accent-[#0D3B2E]"
                  />
                  Marcar como despesa recorrente mensal
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-sm font-semibold text-white bg-[#0D3B2E] rounded-lg hover:bg-[#14533F] cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Salvando...' : editing ? 'Atualizar despesa' : 'Salvar despesa'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
              <Receipt className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Nenhuma despesa encontrada</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Registre suas compras e contas do dia a dia para visualizar onde a família está
              gastando mais.
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Registrar primeira despesa
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4">Descrição e categoria</th>
                  <th className="py-3 px-4">Pagamento</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num text-xs text-slate-600 whitespace-nowrap">
                      {formatDateBR(exp.date)}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900">{exp.description}</p>
                      <p className="text-xs text-slate-500">
                        {exp.category} · {exp.subcategory} · {exp.responsibleName}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {exp.paymentMethod}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleExpenseStatus(exp)}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer ${
                          exp.status === 'pago' ? 'text-[#15803D]' : 'text-amber-700'
                        }`}
                      >
                        {exp.status === 'pago' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        {exp.status === 'pago' ? 'Pago' : 'Pendente'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                      - {formatBRL(exp.amount)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(exp)}
                          aria-label="Editar despesa"
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(exp)}
                          aria-label="Excluir despesa"
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Confirmar exclusão de despesa"
        description={`Deseja excluir a despesa "${deleteTarget?.description}" no valor de ${formatBRL(
          deleteTarget?.amount || 0
        )}?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteExpense(deleteTarget);
          setDeleteTarget(null);
          onNotify('Despesa excluída.');
        }}
      />
    </div>
  );
}
