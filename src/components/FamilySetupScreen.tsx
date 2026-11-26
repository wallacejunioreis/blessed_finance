import React, { useState } from 'react';
import { ArrowRight, Check, Home, SkipForward, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { FamilyRole } from '../types/finance';
import { getTodayBrazilISO } from '../utils/formatters';

export function FamilySetupScreen() {
  const {
    user,
    profile,
    pendingInviteCode,
    createFamily,
    joinFamilyByCode,
    signOut,
  } = useAuth();

  const [tab, setTab] = useState<'create' | 'join'>(pendingInviteCode ? 'join' : 'create');
  const [familyName, setFamilyName] = useState('');
  const [displayName, setDisplayName] = useState(
    profile?.displayName || user?.displayName || ''
  );
  const [role, setRole] = useState<FamilyRole>(() => {
    try {
      const saved = sessionStorage.getItem('bf_pending_role') as FamilyRole | null;
      if (saved === 'marido' || saved === 'esposa' || saved === 'familiar') return saved;
    } catch {
      // ignore
    }
    return profile?.role || 'marido';
  });
  const [inviteCode, setInviteCode] = useState(pendingInviteCode || '');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!familyName.trim() || !displayName.trim()) {
      setErrorMsg('Preencha o nome da família e o seu nome.');
      return;
    }
    setBusy(true);
    try {
      await createFamily({ familyName, displayName, role });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar família.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!inviteCode.trim() || !displayName.trim()) {
      setErrorMsg('Informe o código de convite e o seu nome.');
      return;
    }
    setBusy(true);
    try {
      await joinFamilyByCode({ inviteCode, displayName, role });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao ingressar na família.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-7 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0D3B2E] text-[#E6C778] font-bold flex items-center justify-center text-sm font-display">
              BF
            </div>
            <span className="font-bold text-slate-900 font-display">Blessed Finance</span>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Sair
          </button>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">Conecte sua família</h1>
          <p className="text-sm text-slate-600">
            Crie o espaço financeiro da sua casa ou entre utilizando o código compartilhado pelo seu
            cônjuge.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setTab('create');
              setErrorMsg('');
            }}
            className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              tab === 'create' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            Criar nova família
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('join');
              setErrorMsg('');
            }}
            className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              tab === 'join' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Entrar com convite
          </button>
        </div>

        {errorMsg && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {errorMsg}
          </div>
        )}

        <form onSubmit={tab === 'create' ? handleCreate : handleJoin} className="space-y-4">
          {tab === 'create' ? (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Nome da família
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="Ex.: Família Oliveira"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Código de convite familiar
              </label>
              <input
                type="text"
                required
                maxLength={16}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="Ex.: AB12CD34"
                className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Seu nome</label>
            <input
              type="text"
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Como você deseja aparecer nos lançamentos"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Seu perfil na família
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'marido', label: 'Marido' },
                  { id: 'esposa', label: 'Esposa' },
                  { id: 'familiar', label: 'Familiar' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRole(opt.id)}
                  className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    role === opt.id
                      ? 'bg-[#0D3B2E] text-white border-[#0D3B2E]'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer disabled:opacity-50"
          >
            {busy
              ? 'Conectando...'
              : tab === 'create'
              ? 'Criar espaço da família'
              : 'Entrar na família'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export function FirstAccessWizard() {
  const { family, profile, updateFamilyName, completeOnboarding } = useAuth();
  const { addIncome, addFixedBill, addDebt, addReserveGoal } = useFinance();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Step 1: Family name
  const [famName, setFamName] = useState(family?.name || '');

  // Step 2: Members reminder / copy invite
  const [copied, setCopied] = useState(false);

  // Step 3: Monthly income
  const [incomeDesc, setIncomeDesc] = useState('Salário Mensal');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeCategory, setIncomeCategory] = useState(
    profile?.role === 'esposa' ? 'Salário da esposa' : 'Salário do marido'
  );

  // Step 4: Main fixed bill
  const [billName, setBillName] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billDay, setBillDay] = useState('10');

  // Step 5: Existing debt
  const [debtName, setDebtName] = useState('');
  const [debtCreditor, setDebtCreditor] = useState('');
  const [debtTotal, setDebtTotal] = useState('');
  const [debtInstallments, setDebtInstallments] = useState('12');

  // Step 6: Initial savings goal
  const [goalName, setGoalName] = useState('Reserva de Emergência da Família');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalMonthly, setGoalMonthly] = useState('');

  const inviteUrl =
    typeof window !== 'undefined' && family?.inviteCode
      ? `${window.location.origin}/?convite=${family.inviteCode}`
      : '';

  const handleNext = async () => {
    setErrorMsg('');
    setBusy(true);
    try {
      if (step === 1 && famName.trim() && famName.trim() !== family?.name) {
        await updateFamilyName(famName.trim());
      } else if (step === 3 && Number(incomeAmount) > 0) {
        await addIncome({
          description: incomeDesc || 'Salário Mensal',
          amount: Number(incomeAmount),
          date: getTodayBrazilISO(),
          category: incomeCategory,
          responsibleName: profile?.displayName || 'Integrante',
          notes: 'Configuração inicial',
        });
      } else if (step === 4 && billName.trim() && Number(billAmount) > 0) {
        await addFixedBill({
          name: billName.trim(),
          expectedAmount: Number(billAmount),
          dueDay: Number(billDay) || 10,
          frequency: 'mensal',
          category: 'Contas da Casa',
          subcategory: 'Outras contas',
          active: true,
        });
      } else if (step === 5 && debtName.trim() && Number(debtTotal) > 0) {
        const totalAmt = Number(debtTotal);
        const totalInst = Math.max(1, Number(debtInstallments) || 1);
        await addDebt({
          name: debtName.trim(),
          creditor: debtCreditor.trim() || 'Instituição financeira',
          originalAmount: totalAmt,
          currentAmount: totalAmt,
          installmentAmount: Math.round((totalAmt / totalInst) * 100) / 100,
          totalInstallments: totalInst,
          paidInstallments: 0,
          interestRate: 0,
          dueDate: getTodayBrazilISO(),
        });
      } else if (step === 6 && goalName.trim() && Number(goalTarget) > 0) {
        await addReserveGoal({
          name: goalName.trim(),
          targetAmount: Number(goalTarget),
          monthlyContribution: Number(goalMonthly) || 0,
        });
      }

      if (step >= 6) {
        await completeOnboarding();
      } else {
        setStep((s) => s + 1);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar etapa.');
    } finally {
      setBusy(false);
    }
  };

  const handleSkipAll = async () => {
    setBusy(true);
    try {
      await completeOnboarding();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl p-7 sm:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#C89B3C]">
              Configuração Inicial · Etapa {step} de 6
            </p>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              Bem-vindos ao Blessed Finance
            </h1>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleSkipAll}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap cursor-pointer"
          >
            Configurar depois
          </button>
        </div>

        {/* Progress bar */}
        <div className="grid grid-cols-6 gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className={`h-1.5 rounded-full transition-colors ${
                n <= step ? 'bg-[#0D3B2E]' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        {errorMsg && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {errorMsg}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">1. Nome da família</h2>
            <p className="text-sm text-slate-600">
              Confirme como o espaço financeiro da sua casa será identificado.
            </p>
            <input
              type="text"
              value={famName}
              onChange={(e) => setFamName(e.target.value)}
              placeholder="Ex.: Família Oliveira"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              2. Compartilhar com marido ou esposa
            </h2>
            <p className="text-sm text-slate-600">
              Envie o código ou link abaixo para que seu cônjuge tenha acesso em tempo real às
              movimentações da família. Você também pode convidar depois em Família.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Código de convite</span>
                <span className="font-mono font-bold text-base text-[#0D3B2E]">
                  {family?.inviteCode}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(inviteUrl || family?.inviteCode || '');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }}
                className="w-full py-2 px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center justify-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : null}
                {copied ? 'Link de convite copiado!' : 'Copiar link de convite'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              3. Renda mensal familiar (opcional)
            </h2>
            <p className="text-sm text-slate-600">
              Informe uma receita inicial para começar a acompanhar o orçamento, ou pule para
              preencher depois.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Descrição</label>
                <input
                  type="text"
                  value={incomeDesc}
                  onChange={(e) => setIncomeDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={incomeAmount}
                  onChange={(e) => setIncomeAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono-num"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Categoria</label>
              <select
                value={incomeCategory}
                onChange={(e) => setIncomeCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="Salário do marido">Salário do marido</option>
                <option value="Salário da esposa">Salário da esposa</option>
                <option value="Renda extra">Renda extra</option>
                <option value="Outros recebimentos">Outros recebimentos</option>
              </select>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              4. Primeira conta fixa (opcional)
            </h2>
            <p className="text-sm text-slate-600">
              Cadastre uma conta recorrente importante (ex.: Energia elétrica, Aluguel, Internet).
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">Nome</label>
                <input
                  type="text"
                  value={billName}
                  onChange={(e) => setBillName(e.target.value)}
                  placeholder="Ex.: Energia"
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
                  min="0"
                  value={billAmount}
                  onChange={(e) => setBillAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Dia vencimento
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={billDay}
                  onChange={(e) => setBillDay(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono-num"
                />
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              5. Dívidas existentes (opcional)
            </h2>
            <p className="text-sm text-slate-600">
              Se vocês têm algum financiamento ou parcelamento em andamento, registre aqui para
              acompanhar a quitação passo a passo.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nome da dívida
                </label>
                <input
                  type="text"
                  value={debtName}
                  onChange={(e) => setDebtName(e.target.value)}
                  placeholder="Ex.: Financiamento"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Banco ou credor
                </label>
                <input
                  type="text"
                  value={debtCreditor}
                  onChange={(e) => setDebtCreditor(e.target.value)}
                  placeholder="Ex.: Caixa"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Valor atual (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={debtTotal}
                  onChange={(e) => setDebtTotal(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Parcelas restantes
                </label>
                <input
                  type="number"
                  min="1"
                  value={debtInstallments}
                  onChange={(e) => setDebtInstallments(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono-num"
                />
              </div>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              6. Meta inicial de economia (opcional)
            </h2>
            <p className="text-sm text-slate-600">
              Defina o primeiro sonho ou reserva de segurança para o Nosso Cofrinho.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nome da meta
                </label>
                <input
                  type="text"
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor desejado (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                    placeholder="Ex.: 5000,00"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono-num"
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
                    value={goalMonthly}
                    onChange={(e) => setGoalMonthly(e.target.value)}
                    placeholder="Ex.: 300,00"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono-num"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <button
            type="button"
            disabled={busy}
            onClick={() => (step >= 6 ? handleSkipAll() : setStep((s) => s + 1))}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
            {step >= 6 ? 'Pular e entrar' : 'Pular etapa'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleNext}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer disabled:opacity-50"
          >
            {busy ? 'Salvando...' : step >= 6 ? 'Concluir e acessar painel' : 'Salvar e continuar'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
