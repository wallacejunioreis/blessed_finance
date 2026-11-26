import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, TrendingUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { INCOME_CATEGORIES, Income, MAX_LENGTHS } from '../types/finance';
import { formatBRL, formatDateBR, getCurrentMonthBrazil, getTodayBrazilISO } from '../utils/formatters';
import { ConfirmDialog } from './ConfirmDialog';

interface IncomesViewProps {
  onNotify: (msg: string) => void;
}

export function IncomesView({ onNotify }: IncomesViewProps) {
  const { members, profile } = useAuth();
  const { incomes, addIncome, updateIncome, deleteIncome } = useFinance();

  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('todas');
  const [filterMonth, setFilterMonth] = useState(getCurrentMonthBrazil());

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Income | null>(null);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayBrazilISO());
  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [responsibleName, setResponsibleName] = useState(profile?.displayName || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const filtered = useMemo(() => {
    return incomes.filter((inc) => {
      if (filterMonth && inc.date.slice(0, 7) !== filterMonth) return false;
      if (filterCat !== 'todas' && inc.category !== filterCat) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          inc.description.toLowerCase().includes(q) ||
          inc.category.toLowerCase().includes(q) ||
          inc.responsibleName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [incomes, filterMonth, filterCat, search]);

  const totalFiltered = useMemo(
    () => filtered.reduce((sum, i) => sum + i.amount, 0),
    [filtered]
  );

  const openCreate = () => {
    setEditing(null);
    setDescription('');
    setAmount('');
    setDate(getTodayBrazilISO());
    setCategory(INCOME_CATEGORIES[0]);
    setResponsibleName(profile?.displayName || members[0]?.displayName || '');
    setNotes('');
    setErrorMsg('');
    setShowForm(true);
  };

  const openEdit = (inc: Income) => {
    setEditing(inc);
    setDescription(inc.description);
    setAmount(String(inc.amount));
    setDate(inc.date);
    setCategory(inc.category);
    setResponsibleName(inc.responsibleName);
    setNotes(inc.notes || '');
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
      const payload = {
        description: description.trim(),
        amount: num,
        date,
        category,
        responsibleName: responsibleName || profile?.displayName || 'Integrante',
        responsibleUid: respMember?.uid,
        notes,
      };
      if (editing) {
        await updateIncome(editing.id, payload);
        onNotify('Receita atualizada com sucesso.');
      } else {
        await addIncome(payload);
        onNotify('Receita cadastrada com sucesso.');
      }
      setShowForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar receita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Receitas</h1>
          <p className="text-sm text-slate-600">
            Controle os salários, rendas extras e entradas da família.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Cadastrar receita
        </button>
      </div>

      {/* Filters & Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Buscar</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Descrição ou responsável"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Mês de referência</label>
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
            {INCOME_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-[#E8F5EE] rounded-lg px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-medium text-[#0D3B2E]">Total filtrado</span>
          <span className="text-base font-bold font-mono-num text-[#0D3B2E]">
            {formatBRL(totalFiltered)}
          </span>
        </div>
      </div>

      {/* Inline Form Modal */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            {editing ? 'Editar receita' : 'Nova receita familiar'}
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
                  placeholder="Ex.: Salário empresa"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Valor (R$)</label>
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
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Data de recebimento
                </label>
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
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {INCOME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
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
                  Observações
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.notes}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
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
                {busy ? 'Salvando...' : editing ? 'Atualizar receita' : 'Salvar receita'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List / Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-11 h-11 rounded-xl bg-[#E8F5EE] text-[#0D3B2E] flex items-center justify-center mx-auto">
              <TrendingUp className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Nenhuma receita encontrada</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Cadastre os recebimentos da família para acompanhar o saldo disponível e o orçamento.
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Registrar primeira receita
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4">Categoria</th>
                  <th className="py-3 px-4">Responsável</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-num text-xs text-slate-600 whitespace-nowrap">
                      {formatDateBR(inc.date)}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900">{inc.description}</p>
                      <p className="text-xs text-slate-500">
                        Registrado por {inc.createdByName}
                        {inc.notes ? ` · ${inc.notes}` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {inc.category}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {inc.responsibleName}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-[#15803D] whitespace-nowrap">
                      + {formatBRL(inc.amount)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(inc)}
                          aria-label="Editar receita"
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(inc)}
                          aria-label="Excluir receita"
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
        title="Confirmar exclusão de receita"
        description={`Deseja excluir a receita "${deleteTarget?.description}" no valor de ${formatBRL(
          deleteTarget?.amount || 0
        )}? Esta ação atualizará o saldo da família.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteIncome(deleteTarget);
          setDeleteTarget(null);
          onNotify('Receita excluída.');
        }}
      />
    </div>
  );
}
