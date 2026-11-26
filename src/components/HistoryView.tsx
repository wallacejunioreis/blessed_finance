import { useMemo, useState } from 'react';
import { History, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { EXPENSE_CATEGORIES, Expense, INCOME_CATEGORIES, Income } from '../types/finance';
import { formatBRL, formatDateBR } from '../utils/formatters';
import { ConfirmDialog } from './ConfirmDialog';

interface UnifiedMovement {
  id: string;
  kind: 'receita' | 'despesa' | 'divida' | 'reserva';
  date: string;
  description: string;
  category: string;
  responsibleName: string;
  amount: number;
  rawIncome?: Income;
  rawExpense?: Expense;
}

interface HistoryViewProps {
  onNotify: (msg: string) => void;
}

export function HistoryView({ onNotify }: HistoryViewProps) {
  const { members } = useAuth();
  const {
    incomes,
    expenses,
    debtPayments,
    reserveMovements,
    auditLogs,
    deleteIncome,
    deleteExpense,
  } = useFinance();

  const [tab, setTab] = useState<'movimentacoes' | 'transparencia'>('movimentacoes');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'todos' | 'receita' | 'despesa' | 'divida' | 'reserva'>('todos');
  const [filterCategory, setFilterCategory] = useState('todas');
  const [filterResponsible, setFilterResponsible] = useState('todos');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<UnifiedMovement | null>(null);

  const allCategories = useMemo(
    () => [
      ...INCOME_CATEGORIES,
      ...EXPENSE_CATEGORIES.map((c) => c.label),
      'Pagamento de Dívida',
      'Reserva (Nosso Cofrinho)',
    ],
    []
  );

  const unified = useMemo<UnifiedMovement[]>(() => {
    const list: UnifiedMovement[] = [
      ...incomes.map((i) => ({
        id: `inc-${i.id}`,
        kind: 'receita' as const,
        date: i.date,
        description: i.description,
        category: i.category,
        responsibleName: i.responsibleName,
        amount: i.amount,
        rawIncome: i,
      })),
      ...expenses.map((e) => ({
        id: `exp-${e.id}`,
        kind: 'despesa' as const,
        date: e.date,
        description: e.description,
        category: `${e.category} · ${e.subcategory}`,
        responsibleName: e.responsibleName,
        amount: e.amount,
        rawExpense: e,
      })),
      ...debtPayments.map((p) => ({
        id: `dp-${p.id}`,
        kind: 'divida' as const,
        date: p.date,
        description: `Dívida: ${p.debtName} (${p.paymentType})`,
        category: 'Pagamento de Dívida',
        responsibleName: p.createdByName,
        amount: p.amount,
      })),
      ...reserveMovements.map((m) => ({
        id: `rm-${m.id}`,
        kind: 'reserva' as const,
        date: m.date,
        description: `${m.type === 'deposito' ? 'Depósito' : 'Retirada'}: ${m.goalName}`,
        category: 'Reserva (Nosso Cofrinho)',
        responsibleName: m.createdByName,
        amount: m.amount,
      })),
    ];

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [incomes, expenses, debtPayments, reserveMovements]);

  const filtered = useMemo(() => {
    return unified.filter((item) => {
      if (filterType !== 'todos' && item.kind !== filterType) return false;
      if (filterCategory !== 'todas' && !item.category.includes(filterCategory)) return false;
      if (filterResponsible !== 'todos' && item.responsibleName !== filterResponsible) return false;
      if (startDate && item.date < startDate) return false;
      if (endDate && item.date > endDate) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.responsibleName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [unified, filterType, filterCategory, filterResponsible, startDate, endDate, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Histórico de Movimentações</h1>
          <p className="text-sm text-slate-600">
            Pesquise qualquer registro da família e acompanhe o registro de transparência entre os
            integrantes.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('movimentacoes')}
            className={`px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
              tab === 'movimentacoes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Movimentações ({unified.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('transparencia')}
            className={`px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
              tab === 'transparencia' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Transparência ({auditLogs.length})
          </button>
        </div>
      </div>

      {tab === 'movimentacoes' ? (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Pesquisar</label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Descrição, categoria ou integrante"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
              <select
                value={filterType}
                onChange={(e) =>
                  setFilterType(
                    e.target.value as 'todos' | 'receita' | 'despesa' | 'divida' | 'reserva'
                  )
                }
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="todos">Todos os tipos</option>
                <option value="receita">Receitas</option>
                <option value="despesa">Despesas</option>
                <option value="divida">Dívidas</option>
                <option value="reserva">Reserva</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Categoria</label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="todas">Todas</option>
                {allCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Responsável</label>
              <select
                value={filterResponsible}
                onChange={(e) => setFilterResponsible(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="todos">Todos</option>
                {members.map((m) => (
                  <option key={m.uid} value={m.displayName}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">De</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2 py-2 text-xs rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Até</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2 py-2 text-xs rounded-lg border border-slate-300"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <History className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-900">
                  Nenhuma movimentação encontrada
                </p>
                <p className="text-xs text-slate-500">
                  Ajuste os filtros acima ou registre novas receitas e despesas.
                </p>
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
                    {filtered.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono-num text-xs text-slate-600 whitespace-nowrap">
                          {formatDateBR(item.date)}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {item.description}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">{item.category}</td>
                        <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                          {item.responsibleName}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                            item.kind === 'receita'
                              ? 'text-[#15803D]'
                              : item.kind === 'reserva'
                              ? 'text-[#9A7B2C]'
                              : 'text-slate-900'
                          }`}
                        >
                          {item.kind === 'receita' ? '+' : '-'} {formatBRL(item.amount)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {(item.rawIncome || item.rawExpense) && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(item)}
                              aria-label="Excluir registro"
                              className="p-1.5 rounded-md text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#0D3B2E]" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Histórico de alterações para transparência familiar
              </h2>
              <p className="text-xs text-slate-500">
                Registro automático e permanente das criações, edições, pagamentos e exclusões.
              </p>
            </div>
          </div>

          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Nenhuma ação registrada até o momento.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">{log.summary}</p>
                    <p className="text-xs text-slate-500">
                      {log.entityType} · Por {log.performedByName}
                    </p>
                  </div>
                  <span className="text-xs font-mono-num text-slate-500">
                    {log.createdAt
                      ? new Date(log.createdAt).toLocaleString('pt-BR', {
                          timeZone: 'America/Sao_Paulo',
                        })
                      : 'Agora'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Confirmar exclusão"
        description={`Deseja excluir "${deleteTarget?.description}" (${formatBRL(
          deleteTarget?.amount || 0
        )})?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.rawIncome) {
            await deleteIncome(deleteTarget.rawIncome);
          } else if (deleteTarget.rawExpense) {
            await deleteExpense(deleteTarget.rawExpense);
          }
          setDeleteTarget(null);
          onNotify('Registro excluído do histórico.');
        }}
      />
    </div>
  );
}
