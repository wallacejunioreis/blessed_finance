import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import {
  BillFrequency,
  EXPENSE_CATEGORIES,
  FixedBill,
  MAX_LENGTHS,
  PAYMENT_METHODS,
} from '../types/finance';
import { getFixedBillStatusForMonth } from '../utils/financeCalculations';
import { formatBRL, formatDateBR, getCurrentMonthBrazil, getTodayBrazilISO } from '../utils/formatters';
import { ConfirmDialog } from './ConfirmDialog';

interface FixedBillsViewProps {
  onNotify: (msg: string) => void;
}

const FIXED_SUGGESTIONS = [
  'Energia elétrica',
  'Água',
  'Internet',
  'Telefone',
  'Aluguel',
  'Financiamento',
  'Gás',
  'Academia',
  'Assinaturas',
];

export function FixedBillsView({ onNotify }: FixedBillsViewProps) {
  const { fixedBills, addFixedBill, updateFixedBill, payFixedBill, deleteFixedBill } =
    useFinance();

  const currentMonth = getCurrentMonthBrazil();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FixedBill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FixedBill | null>(null);
  const [payTarget, setPayTarget] = useState<FixedBill | null>(null);

  const [name, setName] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [frequency, setFrequency] = useState<BillFrequency>('mensal');
  const [category, setCategory] = useState('Contas da Casa');
  const [subcategory, setSubcategory] = useState('Energia elétrica');
  const [notes, setNotes] = useState('');

  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(getTodayBrazilISO());
  const [payMethod, setPayMethod] = useState(PAYMENT_METHODS[0]);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const selectedCatObj =
    EXPENSE_CATEGORIES.find((c) => c.label === category) || EXPENSE_CATEGORIES[1];

  const billsWithStatus = useMemo(() => {
    return fixedBills.map((bill) => ({
      bill,
      computed: getFixedBillStatusForMonth(bill, currentMonth),
    }));
  }, [fixedBills, currentMonth]);

  const summary = useMemo(() => {
    const active = billsWithStatus.filter((b) => b.bill.active);
    const totalExpected = active.reduce((s, b) => s + b.bill.expectedAmount, 0);
    const paidCount = active.filter((b) => b.computed.status === 'paga').length;
    const overdueCount = active.filter((b) => b.computed.status === 'vencida').length;
    const soonCount = active.filter((b) => b.computed.status === 'proxima').length;
    const pendingTotal = active
      .filter((b) => b.computed.status !== 'paga')
      .reduce((s, b) => s + b.bill.expectedAmount, 0);
    return { totalExpected, paidCount, overdueCount, soonCount, pendingTotal, total: active.length };
  }, [billsWithStatus]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setExpectedAmount('');
    setDueDay('10');
    setFrequency('mensal');
    setCategory('Contas da Casa');
    setSubcategory('Energia elétrica');
    setNotes('');
    setErrorMsg('');
    setShowForm(true);
  };

  const openEdit = (bill: FixedBill) => {
    setEditing(bill);
    setName(bill.name);
    setExpectedAmount(String(bill.expectedAmount));
    setDueDay(String(bill.dueDay));
    setFrequency(bill.frequency);
    setCategory(bill.category);
    setSubcategory(bill.subcategory);
    setNotes(bill.notes || '');
    setErrorMsg('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const num = Number(expectedAmount.replace(',', '.'));
    if (!name.trim() || !Number.isFinite(num) || num <= 0) {
      setErrorMsg('Informe o nome e o valor previsto maior que zero.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        expectedAmount: num,
        dueDay: Math.min(Math.max(Number(dueDay) || 10, 1), 31),
        frequency,
        category,
        subcategory,
        active: true,
        notes,
      };
      if (editing) {
        await updateFixedBill(editing.id, payload);
        onNotify('Conta fixa atualizada.');
      } else {
        await addFixedBill(payload);
        onNotify('Conta fixa cadastrada.');
      }
      setShowForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar conta fixa.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setErrorMsg('');
    const num = Number(payAmount.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      setErrorMsg('Informe o valor efetivamente pago.');
      return;
    }

    setBusy(true);
    try {
      await payFixedBill({
        bill: payTarget,
        paidAmount: num,
        paidDate: payDate,
        paymentMethod: payMethod,
      });
      setPayTarget(null);
      onNotify(`Pagamento de "${payTarget.name}" confirmado e lançado nas despesas.`);
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
          <h1 className="text-2xl font-bold text-slate-900">Contas Fixas</h1>
          <p className="text-sm text-slate-600">
            Acompanhe contas recorrentes, vencimentos e evite atrasos ou lançamentos duplicados.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Nova conta fixa
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total previsto no mês</p>
          <p className="text-xl font-bold font-mono-num text-slate-900 mt-1">
            {formatBRL(summary.totalExpected)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Ainda falta pagar</p>
          <p className="text-xl font-bold font-mono-num text-amber-800 mt-1">
            {formatBRL(summary.pendingTotal)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Contas pagas</p>
          <p className="text-xl font-bold font-mono-num text-[#15803D] mt-1">
            {summary.paidCount} de {summary.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Alertas de vencimento</p>
          <p className="text-sm font-semibold text-slate-900 mt-1.5">
            {summary.overdueCount} vencida(s) · {summary.soonCount} próxima(s)
          </p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            {editing ? 'Editar conta fixa' : 'Cadastrar conta fixa'}
          </h2>

          {!editing && (
            <div className="flex flex-wrap gap-1.5">
              {FIXED_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setName(sug)}
                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 cursor-pointer"
                >
                  {sug}
                </button>
              ))}
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nome da conta
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.billName}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Energia elétrica"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Valor previsto (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Dia do vencimento
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Frequência</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as BillFrequency)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="mensal">Mensal</option>
                  <option value="bimestral">Bimestral</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="anual">Anual</option>
                </select>
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
                      {c.label}
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
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Observações</label>
              <input
                type="text"
                maxLength={MAX_LENGTHS.notes}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: Débito automático ou código de cliente"
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
                {busy ? 'Salvando...' : editing ? 'Atualizar conta' : 'Salvar conta fixa'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {billsWithStatus.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-[#E8F5EE] text-[#0D3B2E] flex items-center justify-center mx-auto">
            <CalendarCheck2 className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Nenhuma conta fixa cadastrada</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Cadastre água, luz, aluguel, internet e assinaturas para receber alertas antes do
            vencimento.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar primeira conta fixa
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {billsWithStatus.map(({ bill, computed }) => {
            const isPaid = computed.status === 'paga';
            const isOverdue = computed.status === 'vencida';
            const isSoon = computed.status === 'proxima';

            return (
              <div
                key={bill.id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900">{bill.name}</h3>
                    <p className="text-xs text-slate-500">
                      {bill.category} · {bill.subcategory} · Frequência {bill.frequency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono-num text-slate-900">
                      {formatBRL(bill.expectedAmount)}
                    </p>
                    <p className="text-[11px] text-slate-500">Valor previsto</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                  <div
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                      isPaid
                        ? 'text-[#15803D]'
                        : isOverdue
                        ? 'text-red-700'
                        : isSoon
                        ? 'text-amber-700'
                        : 'text-slate-600'
                    }`}
                  >
                    {isPaid ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : isOverdue || isSoon ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : (
                      <Clock className="w-4 h-4" />
                    )}
                    <span>
                      {computed.label}
                      {isPaid && bill.lastPaidDate
                        ? ` (${formatDateBR(bill.lastPaidDate)} · ${formatBRL(bill.lastPaidAmount)})`
                        : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isPaid && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayTarget(bill);
                          setPayAmount(String(bill.expectedAmount));
                          setPayDate(getTodayBrazilISO());
                          setPayMethod(PAYMENT_METHODS[0]);
                          setErrorMsg('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer whitespace-nowrap"
                      >
                        Confirmar pagamento
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(bill)}
                      aria-label="Editar conta fixa"
                      className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(bill)}
                      aria-label="Excluir conta fixa"
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

      {/* Confirm Payment Modal */}
      {payTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">
              Confirmar pagamento: {payTarget.name}
            </h3>
            <p className="text-xs text-slate-600">
              Ao confirmar, o sistema registra o pagamento sem duplicidade no mês e atualiza suas
              despesas automaticamente.
            </p>
            {errorMsg && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {errorMsg}
              </div>
            )}
            <form onSubmit={handleConfirmPay} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Valor efetivamente pago (R$)
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Data do pagamento
                  </label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Forma de pagamento
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
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
                  {busy ? 'Confirmando...' : 'Confirmar pagamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remover conta fixa"
        description={`Deseja remover a conta fixa "${deleteTarget?.name}"? Os lançamentos já pagos permanecerão no histórico.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteFixedBill(deleteTarget);
          setDeleteTarget(null);
          onNotify('Conta fixa removida.');
        }}
      />
    </div>
  );
}
