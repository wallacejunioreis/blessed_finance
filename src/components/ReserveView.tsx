import React, { useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { MAX_LENGTHS, ReserveGoal } from '../types/finance';
import { formatBRL, formatDateBR, formatPercent, getTodayBrazilISO } from '../utils/formatters';
import { ConfirmDialog } from './ConfirmDialog';

interface ReserveViewProps {
  onNotify: (msg: string) => void;
}

export function ReserveView({ onNotify }: ReserveViewProps) {
  const {
    reserves,
    reserveMovements,
    addReserveGoal,
    updateReserveGoal,
    moveReserve,
    deleteReserveGoal,
  } = useFinance();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ReserveGoal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReserveGoal | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    goal: ReserveGoal;
    type: 'deposito' | 'retirada';
  } | null>(null);

  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [monthlyContribution, setMonthlyContribution] = useState('');
  const [notes, setNotes] = useState('');

  const [moveAmount, setMoveAmount] = useState('');
  const [moveDate, setMoveDate] = useState(getTodayBrazilISO());
  const [moveNotes, setMoveNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const totals = useMemo(() => {
    const saved = reserves.reduce((s, r) => s + r.currentAmount, 0);
    const target = reserves.reduce((s, r) => s + r.targetAmount, 0);
    const monthly = reserves.reduce((s, r) => s + r.monthlyContribution, 0);
    const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
    return { saved, target, monthly, pct };
  }, [reserves]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setTargetAmount('');
    setMonthlyContribution('');
    setNotes('');
    setErrorMsg('');
    setShowForm(true);
  };

  const openEdit = (goal: ReserveGoal) => {
    setEditing(goal);
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setMonthlyContribution(String(goal.monthlyContribution));
    setNotes(goal.notes || '');
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const targetNum = Number(targetAmount.replace(',', '.'));
    const monthlyNum = Number((monthlyContribution || '0').replace(',', '.'));
    if (!name.trim() || !Number.isFinite(targetNum) || targetNum <= 0) {
      setErrorMsg('Informe o nome da meta e o valor desejado maior que zero.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        targetAmount: targetNum,
        monthlyContribution: Number.isFinite(monthlyNum) ? Math.max(0, monthlyNum) : 0,
        notes,
      };
      if (editing) {
        await updateReserveGoal(editing.id, payload);
        onNotify('Meta atualizada no Nosso Cofrinho.');
      } else {
        await addReserveGoal(payload);
        onNotify('Nova meta criada no Nosso Cofrinho!');
      }
      setShowForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar meta.');
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveTarget) return;
    setErrorMsg('');
    const val = Number(moveAmount.replace(',', '.'));
    if (!Number.isFinite(val) || val <= 0) {
      setErrorMsg('Informe um valor válido maior que zero.');
      return;
    }

    setBusy(true);
    try {
      await moveReserve({
        goal: moveTarget.goal,
        type: moveTarget.type,
        amount: val,
        date: moveDate,
        notes: moveNotes,
      });
      onNotify(
        moveTarget.type === 'deposito'
          ? `Depósito de ${formatBRL(val)} guardado em "${moveTarget.goal.name}"!`
          : `Retirada de ${formatBRL(val)} registrada.`
      );
      setMoveTarget(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro na movimentação.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nossa Reserva — Nosso Cofrinho</h1>
          <p className="text-sm text-slate-600">
            Cada depósito fortalece a segurança da casa e aproxima a família dos seus sonhos.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Nova meta financeira
        </button>
      </div>

      {/* Hero Summary Card */}
      <section className="bg-[#0D3B2E] text-white rounded-xl p-6 sm:p-7 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-emerald-100/80">Saldo total guardado</p>
            <p className="text-2xl sm:text-3xl font-bold font-mono-num text-[#E6C778] mt-1">
              {formatBRL(totals.saved)}
            </p>
          </div>
          <div>
            <p className="text-xs text-emerald-100/80">Soma das metas</p>
            <p className="text-2xl font-bold font-mono-num mt-1">{formatBRL(totals.target)}</p>
          </div>
          <div>
            <p className="text-xs text-emerald-100/80">Contribuição mensal planejada</p>
            <p className="text-2xl font-bold font-mono-num mt-1">{formatBRL(totals.monthly)}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-emerald-100/90">
            <span>Progresso geral das metas</span>
            <span className="font-mono-num font-semibold">{formatPercent(totals.pct)}</span>
          </div>
          <div className="w-full h-3 bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#C89B3C] rounded-full transition-all duration-300"
              style={{ width: `${totals.pct}%` }}
            />
          </div>
        </div>
      </section>

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            {editing ? 'Editar meta do cofrinho' : 'Criar nova meta financeira'}
          </h2>
          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nome da meta
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.goalName}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Reserva de Emergência"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Valor desejado (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  placeholder="5000,00"
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contribuição mensal (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(e.target.value)}
                  placeholder="300,00"
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Propósito / Observações
              </label>
              <input
                type="text"
                maxLength={MAX_LENGTHS.notes}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: Segurança para imprevistos da família"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
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
                {busy ? 'Salvando...' : editing ? 'Atualizar meta' : 'Criar meta'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Goals Grid */}
      {reserves.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-[#FEF9EC] text-[#9A7B2C] flex items-center justify-center mx-auto">
            <PiggyBank className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-900">
            Crie a primeira meta do Nosso Cofrinho
          </p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Definam um objetivo juntos — seja uma reserva de emergência, viagem ou reforma — e
            acompanhem cada conquista.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar primeira meta
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reserves.map((goal) => {
            const pct =
              goal.targetAmount > 0
                ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)
                : 0;
            const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);

            return (
              <div
                key={goal.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{goal.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Meta: {formatBRL(goal.targetAmount)} · Contribuição mensal:{' '}
                      {formatBRL(goal.monthlyContribution)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono-num text-[#0D3B2E]">
                      {formatBRL(goal.currentAmount)}
                    </p>
                    <p className="text-[11px] font-semibold text-[#9A7B2C]">
                      {pct.toFixed(1).replace('.', ',')}% atingido
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#0D3B2E] to-[#16A34A] rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    {remaining === 0
                      ? 'Meta alcançada com sucesso!'
                      : `Faltam ${formatBRL(remaining)} para atingir a meta`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMoveTarget({ goal, type: 'deposito' });
                        setMoveAmount('');
                        setMoveDate(getTodayBrazilISO());
                        setMoveNotes('');
                        setErrorMsg('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer"
                    >
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                      Depositar
                    </button>
                    <button
                      type="button"
                      disabled={goal.currentAmount <= 0}
                      onClick={() => {
                        setMoveTarget({ goal, type: 'retirada' });
                        setMoveAmount('');
                        setMoveDate(getTodayBrazilISO());
                        setMoveNotes('');
                        setErrorMsg('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-40"
                    >
                      <ArrowDownCircle className="w-3.5 h-3.5" />
                      Retirar
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(goal)}
                      aria-label="Editar meta"
                      className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(goal)}
                      aria-label="Excluir meta"
                      className="p-1.5 rounded-md text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Movement History */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">Histórico do Nosso Cofrinho</h2>
          <p className="text-xs text-slate-500">
            Transferências para a reserva não são duplicadas como despesas operacionais.
          </p>
        </div>

        {reserveMovements.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Nenhuma movimentação registrada na reserva ainda.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reserveMovements.map((mov) => (
              <div
                key={mov.id}
                className="px-5 py-3 flex items-center justify-between gap-4 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {mov.type === 'deposito' ? 'Depósito' : 'Retirada'} · {mov.goalName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateBR(mov.date)} · Por {mov.createdByName}
                    {mov.notes ? ` · ${mov.notes}` : ''}
                  </p>
                </div>
                <span
                  className={`font-mono-num font-semibold whitespace-nowrap ${
                    mov.type === 'deposito' ? 'text-[#15803D]' : 'text-amber-800'
                  }`}
                >
                  {mov.type === 'deposito' ? '+' : '-'} {formatBRL(mov.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Deposit/Withdraw Modal */}
      {moveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">
              {moveTarget.type === 'deposito' ? 'Guardar dinheiro em ' : 'Retirar de '}
              {moveTarget.goal.name}
            </h3>
            {errorMsg && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {errorMsg}
              </div>
            )}
            <form onSubmit={handleMove} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={moveAmount}
                    onChange={(e) => setMoveAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Data</label>
                  <input
                    type="date"
                    required
                    value={moveDate}
                    onChange={(e) => setMoveDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Observações (opcional)
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.notes}
                  value={moveNotes}
                  onChange={(e) => setMoveNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setMoveTarget(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#0D3B2E] rounded-lg hover:bg-[#14533F] cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Processando...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir meta da reserva"
        description={`Deseja excluir a meta "${deleteTarget?.name}"?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteReserveGoal(deleteTarget);
          setDeleteTarget(null);
          onNotify('Meta removida.');
        }}
      />
    </div>
  );
}
