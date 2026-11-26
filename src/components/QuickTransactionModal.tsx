import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  MAX_LENGTHS,
  PAYMENT_METHODS,
} from '../types/finance';
import { getTodayBrazilISO } from '../utils/formatters';

interface QuickTransactionModalProps {
  open: boolean;
  initialType?: 'despesa' | 'receita';
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export function QuickTransactionModal({
  open,
  initialType = 'despesa',
  onClose,
  onSuccess,
}: QuickTransactionModalProps) {
  const { members, profile } = useAuth();
  const { addExpense, addIncome } = useFinance();

  const [txType, setTxType] = useState<'despesa' | 'receita'>(initialType);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayBrazilISO());
  const [incomeCategory, setIncomeCategory] = useState(INCOME_CATEGORIES[0]);
  const [expenseCategory, setExpenseCategory] = useState(EXPENSE_CATEGORIES[0].label);
  const [expenseSubcategory, setExpenseSubcategory] = useState(
    EXPENSE_CATEGORIES[0].subcategories[0]
  );
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [status, setStatus] = useState<'pago' | 'pendente'>('pago');
  const [installments, setInstallments] = useState('1');
  const [isRecurring, setIsRecurring] = useState(false);
  const [responsibleName, setResponsibleName] = useState(profile?.displayName || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!open) return null;

  const selectedCatObj =
    EXPENSE_CATEGORIES.find((c) => c.label === expenseCategory) || EXPENSE_CATEGORIES[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const numAmount = Number(amount.replace(',', '.'));
    if (!description.trim()) {
      setErrorMsg('Informe uma descrição para o lançamento.');
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setErrorMsg('Informe um valor válido maior que zero.');
      return;
    }

    setBusy(true);
    try {
      const respMember = members.find((m) => m.displayName === responsibleName);
      if (txType === 'despesa') {
        await addExpense({
          description: description.trim(),
          category: expenseCategory,
          subcategory: expenseSubcategory,
          amount: numAmount,
          date,
          paymentMethod,
          responsibleName: responsibleName || profile?.displayName || 'Integrante',
          responsibleUid: respMember?.uid,
          notes,
          status,
          installments: Math.max(1, Number(installments) || 1),
          isRecurring,
        });
        onSuccess?.('Despesa registrada com sucesso.');
      } else {
        await addIncome({
          description: description.trim(),
          amount: numAmount,
          date,
          category: incomeCategory,
          responsibleName: responsibleName || profile?.displayName || 'Integrante',
          responsibleUid: respMember?.uid,
          notes,
        });
        onSuccess?.('Receita registrada com sucesso.');
      }
      setDescription('');
      setAmount('');
      setNotes('');
      setInstallments('1');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar lançamento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full sm:max-w-lg bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl max-h-[92vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Novo lançamento rápido</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setTxType('despesa')}
            className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              txType === 'despesa' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Despesa (Saída)
          </button>
          <button
            type="button"
            onClick={() => setTxType('receita')}
            className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              txType === 'receita' ? 'bg-white text-[#0D3B2E] shadow-sm' : 'text-slate-600'
            }`}
          >
            Receita (Entrada)
          </button>
        </div>

        {errorMsg && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="w-full px-3.5 py-2.5 text-base font-bold font-mono-num rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Data</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Descrição</label>
            <input
              type="text"
              required
              maxLength={MAX_LENGTHS.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                txType === 'despesa' ? 'Ex.: Supermercado da semana' : 'Ex.: Salário mensal'
              }
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
            />
          </div>

          {txType === 'despesa' ? (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Categoria
                  </label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => {
                      const nextCat = e.target.value;
                      setExpenseCategory(nextCat);
                      const found = EXPENSE_CATEGORIES.find((c) => c.label === nextCat);
                      if (found) setExpenseSubcategory(found.subcategories[0]);
                    }}
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white"
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
                    value={expenseSubcategory}
                    onChange={(e) => setExpenseSubcategory(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    {selectedCatObj.subcategories.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Pagamento
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'pago' | 'pendente')}
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="pago">Pago</option>
                    <option value="pendente">Pendente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Parcelas
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={installments}
                    onChange={(e) => setInstallments(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm font-mono-num rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="rounded border-slate-300 accent-[#0D3B2E]"
                />
                Despesa recorrente (repete mensalmente)
              </label>
            </>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Categoria</label>
              <select
                value={incomeCategory}
                onChange={(e) => setIncomeCategory(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white"
              >
                {INCOME_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Responsável</label>
              <select
                value={responsibleName}
                onChange={(e) => setResponsibleName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white"
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
                Observações (opcional)
              </label>
              <input
                type="text"
                maxLength={MAX_LENGTHS.notes}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalhes adicionais"
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0D3B2E] rounded-lg hover:bg-[#14533F] cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Salvando...' : 'Salvar lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
