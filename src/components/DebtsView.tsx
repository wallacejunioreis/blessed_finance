import React, { useMemo, useState } from 'react';
import { CheckCircle2, Landmark, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { Debt, MAX_LENGTHS, PAYMENT_METHODS } from '../types/finance';
import { DebtStrategy, sortDebtsByStrategy } from '../utils/financeCalculations';
import { formatBRL, formatDateBR, formatPercent, getTodayBrazilISO } from '../utils/formatters';
import { ConfirmDialog } from './ConfirmDialog';

interface DebtsViewProps {
  onNotify: (msg: string) => void;
}

export function DebtsView({ onNotify }: DebtsViewProps) {
  const { debts, addDebt, updateDebt, payDebt, deleteDebt } = useFinance();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Debt | null>(null);
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [strategy, setStrategy] = useState<DebtStrategy>('avalanche');

  // Debt Form
  const [name, setName] = useState('');
  const [creditor, setCreditor] = useState('');
  const [originalAmount, setOriginalAmount] = useState('');
  const [currentAmount, setCurrentAmount] = useState('');
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('12');
  const [paidInstallments, setPaidInstallments] = useState('0');
  const [interestRate, setInterestRate] = useState('0');
  const [dueDate, setDueDate] = useState(getTodayBrazilISO());
  const [notes, setNotes] = useState('');

  // Payment Form
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(getTodayBrazilISO());
  const [paymentType, setPaymentType] = useState<'parcela' | 'parcial' | 'quitacao'>('parcela');
  const [recordAsExpense, setRecordAsExpense] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [payNotes, setPayNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const summary = useMemo(() => {
    const totalOriginal = debts.reduce((s, d) => s + d.originalAmount, 0);
    const totalRemaining = debts
      .filter((d) => d.status === 'ativa')
      .reduce((s, d) => s + d.currentAmount, 0);
    const totalPaid = Math.max(0, totalOriginal - totalRemaining);
    const paidOffCount = debts.filter((d) => d.status === 'quitada').length;
    const nextInstallmentsTotal = debts
      .filter((d) => d.status === 'ativa')
      .reduce((s, d) => s + d.installmentAmount, 0);
    const overallProgress =
      totalOriginal > 0 ? Math.min(100, (totalPaid / totalOriginal) * 100) : 0;

    return {
      totalOriginal,
      totalPaid,
      totalRemaining,
      paidOffCount,
      nextInstallmentsTotal,
      overallProgress,
    };
  }, [debts]);

  const prioritizedDebts = useMemo(
    () => sortDebtsByStrategy(debts, strategy),
    [debts, strategy]
  );

  const openCreate = () => {
    setEditing(null);
    setName('');
    setCreditor('');
    setOriginalAmount('');
    setCurrentAmount('');
    setInstallmentAmount('');
    setTotalInstallments('12');
    setPaidInstallments('0');
    setInterestRate('0');
    setDueDate(getTodayBrazilISO());
    setNotes('');
    setErrorMsg('');
    setShowForm(true);
  };

  const openEdit = (d: Debt) => {
    setEditing(d);
    setName(d.name);
    setCreditor(d.creditor);
    setOriginalAmount(String(d.originalAmount));
    setCurrentAmount(String(d.currentAmount));
    setInstallmentAmount(String(d.installmentAmount));
    setTotalInstallments(String(d.totalInstallments));
    setPaidInstallments(String(d.paidInstallments));
    setInterestRate(String(d.interestRate));
    setDueDate(d.dueDate);
    setNotes(d.notes || '');
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const orig = Number(originalAmount.replace(',', '.'));
    const curr = Number((currentAmount || originalAmount).replace(',', '.'));
    const inst = Number((installmentAmount || '0').replace(',', '.'));
    if (!name.trim() || !creditor.trim() || !Number.isFinite(orig) || orig <= 0) {
      setErrorMsg('Informe o nome, credor e valor original válido.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        creditor: creditor.trim(),
        originalAmount: orig,
        currentAmount: Number.isFinite(curr) ? Math.max(0, curr) : orig,
        installmentAmount: Number.isFinite(inst) ? Math.max(0, inst) : 0,
        totalInstallments: Math.max(1, Number(totalInstallments) || 1),
        paidInstallments: Math.max(0, Number(paidInstallments) || 0),
        interestRate: Math.max(0, Number(interestRate.replace(',', '.')) || 0),
        dueDate,
        notes,
      };
      if (editing) {
        await updateDebt(editing.id, payload);
        onNotify('Dívida atualizada.');
      } else {
        await addDebt(payload);
        onNotify('Dívida cadastrada com sucesso.');
      }
      setShowForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar dívida.');
    } finally {
      setBusy(false);
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setErrorMsg('');
    const val = Number(payAmount.replace(',', '.'));
    if (!Number.isFinite(val) || val <= 0) {
      setErrorMsg('Informe um valor válido maior que zero.');
      return;
    }

    setBusy(true);
    try {
      await payDebt({
        debt: payTarget,
        amount: val,
        date: payDate,
        paymentType,
        recordAsExpense,
        paymentMethod,
        notes: payNotes,
      });
      setPayTarget(null);
      onNotify('Pagamento da dívida registrado com sucesso.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao registrar pagamento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Minhas Dívidas</h1>
          <p className="text-sm text-slate-600">
            Organizem compromissos com clareza, acompanhem cada parcela quitada e planejem a
            liberdade financeira da família.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Cadastrar dívida
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total original</p>
          <p className="text-lg font-bold font-mono-num text-slate-900 mt-1">
            {formatBRL(summary.totalOriginal)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total já pago</p>
          <p className="text-lg font-bold font-mono-num text-[#15803D] mt-1">
            {formatBRL(summary.totalPaid)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Saldo restante</p>
          <p className="text-lg font-bold font-mono-num text-slate-900 mt-1">
            {formatBRL(summary.totalRemaining)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Próximas parcelas</p>
          <p className="text-lg font-bold font-mono-num text-slate-900 mt-1">
            {formatBRL(summary.nextInstallmentsTotal)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Quitação geral</p>
          <p className="text-lg font-bold font-mono-num text-[#0D3B2E] mt-1">
            {formatPercent(summary.overallProgress)} · {summary.paidOffCount} quitada(s)
          </p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            {editing ? 'Editar dívida' : 'Nova dívida'}
          </h2>
          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nome da dívida
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.debtName}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Financiamento do carro"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Banco ou credor
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.creditor}
                  value={creditor}
                  onChange={(e) => setCreditor(e.target.value)}
                  placeholder="Ex.: Banco do Brasil"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Valor original (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={originalAmount}
                  onChange={(e) => setOriginalAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Saldo devedor atual (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={currentAmount}
                  onChange={(e) => setCurrentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Valor da parcela (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={installmentAmount}
                  onChange={(e) => setInstallmentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Total de parcelas
                </label>
                <input
                  type="number"
                  min="1"
                  max="600"
                  required
                  value={totalInstallments}
                  onChange={(e) => setTotalInstallments(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Parcelas já pagas
                </label>
                <input
                  type="number"
                  min="0"
                  max={totalInstallments}
                  required
                  value={paidInstallments}
                  onChange={(e) => setPaidInstallments(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Taxa de juros (% ao mês)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Próximo vencimento
                </label>
                <input
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Observações</label>
              <input
                type="text"
                maxLength={MAX_LENGTHS.notes}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Condições de negociação ou detalhes"
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
                {busy ? 'Salvando...' : editing ? 'Atualizar dívida' : 'Salvar dívida'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Debts List */}
      {debts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-[#E8F5EE] text-[#0D3B2E] flex items-center justify-center mx-auto">
            <Landmark className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Nenhuma dívida registrada</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Se sua família não possui dívidas, ótimo sinal! Caso possua parcelamentos ou empréstimos,
            registre-os para acompanhar cada passo até a quitação.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {debts.map((debt) => {
            const paidVal = Math.max(0, debt.originalAmount - debt.currentAmount);
            const pct =
              debt.originalAmount > 0
                ? Math.min(100, (paidVal / debt.originalAmount) * 100)
                : 0;
            const remainingInstallments = Math.max(
              0,
              debt.totalInstallments - debt.paidInstallments
            );
            const isPaidOff = debt.status === 'quitada';

            return (
              <div
                key={debt.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">{debt.name}</h3>
                      {isPaidOff && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Quitada
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {debt.creditor} · Vencimento {formatDateBR(debt.dueDate)} · Juros{' '}
                      {debt.interestRate.toFixed(1).replace('.', ',')}% a.m.
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono-num text-slate-900">
                      {formatBRL(debt.currentAmount)}
                    </p>
                    <p className="text-[11px] text-slate-500">Saldo restante</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Parcelas: {debt.paidInstallments}/{debt.totalInstallments} (restam{' '}
                      {remainingInstallments})
                    </span>
                    <span className="font-mono-num font-semibold text-[#0D3B2E]">
                      {pct.toFixed(0)}% quitado
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#16A34A] rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                  <span className="text-slate-600">
                    Parcela: <strong className="font-mono-num">{formatBRL(debt.installmentAmount)}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    {!isPaidOff && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setPayTarget(debt);
                            setPaymentType('parcela');
                            setPayAmount(
                              String(debt.installmentAmount || debt.currentAmount)
                            );
                            setPayDate(getTodayBrazilISO());
                            setPayNotes('');
                            setErrorMsg('');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#0D3B2E] text-white font-semibold hover:bg-[#14533F] cursor-pointer"
                        >
                          Registrar pagamento
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(debt)}
                          aria-label="Editar dívida"
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(debt)}
                      aria-label="Excluir dívida"
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

      {/* Prioritization Planner */}
      {prioritizedDebts.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#FEF9EC] text-[#9A7B2C] flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Planejador de Priorização de Dívidas
                </h2>
                <p className="text-xs text-slate-600">
                  Compare estratégias respeitosas e práticas para decidir qual dívida amortizar
                  primeiro.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              {(
                [
                  { id: 'avalanche', label: 'Maior juros' },
                  { id: 'bola_de_neve', label: 'Menor saldo' },
                  { id: 'vencimento', label: 'Vencimento' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStrategy(opt.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    strategy === opt.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {prioritizedDebts.map((debt, idx) => (
              <div
                key={debt.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#0D3B2E] text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">
                      {debt.name} · <span className="text-slate-500 font-normal">{debt.creditor}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Juros {debt.interestRate.toFixed(1).replace('.', ',')}% a.m. · Vence em{' '}
                      {formatDateBR(debt.dueDate)}
                    </p>
                  </div>
                </div>
                <div className="text-right font-mono-num text-xs sm:text-sm font-semibold text-slate-900">
                  Saldo: {formatBRL(debt.currentAmount)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Payment Modal */}
      {payTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">
              Registrar pagamento: {payTarget.name}
            </h3>
            <p className="text-xs text-slate-600">
              Saldo devedor atual:{' '}
              <strong className="font-mono-num">{formatBRL(payTarget.currentAmount)}</strong>
            </p>
            {errorMsg && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {errorMsg}
              </div>
            )}
            <form onSubmit={handlePaySubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'parcela', label: 'Parcela' },
                    { id: 'parcial', label: 'Parcial' },
                    { id: 'quitacao', label: 'Quitação' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setPaymentType(t.id);
                      if (t.id === 'quitacao') {
                        setPayAmount(String(payTarget.currentAmount));
                      } else if (t.id === 'parcela') {
                        setPayAmount(String(payTarget.installmentAmount || payTarget.currentAmount));
                      }
                    }}
                    className={`py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                      paymentType === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor pago (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Data</label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recordAsExpense}
                  onChange={(e) => setRecordAsExpense(e.target.checked)}
                  className="accent-[#0D3B2E]"
                />
                Lançar este pagamento também nas despesas do mês
              </label>

              {recordAsExpense && (
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
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Observações (opcional)
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.notes}
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#0D3B2E] rounded-lg hover:bg-[#14533F] cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Registrando...' : 'Confirmar pagamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir dívida"
        description={`Deseja excluir o registro da dívida "${deleteTarget?.name}"?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteDebt(deleteTarget);
          setDeleteTarget(null);
          onNotify('Dívida excluída.');
        }}
      />
    </div>
  );
}
