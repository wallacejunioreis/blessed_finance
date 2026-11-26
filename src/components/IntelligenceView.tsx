import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  PiggyBank,
  ShieldAlert,
} from 'lucide-react';
import { useFinance } from '../contexts/FinanceContext';
import { generateFinancialInsights } from '../utils/financeCalculations';
import { formatBRL } from '../utils/formatters';

export function IntelligenceView() {
  const { incomes, expenses, fixedBills, debts, reserves, budgets } = useFinance();
  const [dailySave, setDailySave] = useState('10');

  const insights = useMemo(
    () =>
      generateFinancialInsights({
        incomes,
        expenses,
        fixedBills,
        debts,
        reserves,
        budgets,
      }),
    [incomes, expenses, fixedBills, debts, reserves, budgets]
  );

  const dailyAmount = Math.max(0, Number(dailySave.replace(',', '.')) || 0);
  const monthlyProjection = dailyAmount * 30;
  const yearlyProjection = dailyAmount * 365;

  const badgeIcon = (type: string) => {
    switch (type) {
      case 'alerta':
        return <ShieldAlert className="w-5 h-5 text-red-700 shrink-0" />;
      case 'atencao':
        return <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />;
      case 'positivo':
        return <CheckCircle2 className="w-5 h-5 text-[#15803D] shrink-0" />;
      default:
        return <Lightbulb className="w-5 h-5 text-[#9A7B2C] shrink-0" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Inteligência Financeira</h1>
        <p className="text-sm text-slate-600">
          Análises educativas baseadas exclusivamente nos registros reais da sua família — sem
          julgamentos e sem dados inventados.
        </p>
      </div>

      {/* Real-Data Insights */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">
          Diagnóstico automático dos seus registros
        </h2>

        {insights.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
            <Lightbulb className="w-8 h-8 text-[#C89B3C] mx-auto" />
            <p className="text-sm font-semibold text-slate-900">
              Aguardando mais lançamentos para gerar comparativos
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Conforme a família registrar receitas, despesas, contas fixas e metas de planejamento,
              esta tela mostrará análises personalizadas baseadas nos números reais.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.map((ins) => (
              <div
                key={ins.id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex items-start gap-3.5"
              >
                <div className="mt-0.5">{badgeIcon(ins.type)}</div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">{ins.area}</p>
                  <h3 className="text-sm font-bold text-slate-900">{ins.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {ins.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Daily Savings Simulator */}
      <section className="bg-[#0D3B2E] text-white rounded-xl p-6 sm:p-7 grid lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-7 space-y-2">
          <div className="flex items-center gap-2 text-xs text-[#E6C778] font-medium">
            <PiggyBank className="w-4 h-4" />
            <span>Simulador de pequenas escolhas diárias</span>
          </div>
          <h2 className="text-xl font-bold">
            Pequenas escolhas hoje podem transformar o amanhã.
          </h2>
          <p className="text-xs sm:text-sm text-emerald-100/85 leading-relaxed">
            Se economizarem{' '}
            <strong className="font-mono-num text-white">{formatBRL(dailyAmount)}</strong> por dia,
            vocês poderão guardar aproximadamente{' '}
            <strong className="font-mono-num text-[#E6C778]">
              {formatBRL(monthlyProjection)}
            </strong>{' '}
            em um mês de 30 dias e{' '}
            <strong className="font-mono-num text-[#E6C778]">
              {formatBRL(yearlyProjection)}
            </strong>{' '}
            ao longo de um ano.
          </p>
        </div>

        <div className="lg:col-span-5 bg-white/10 border border-white/15 rounded-xl p-4 space-y-3">
          <label className="block text-xs font-medium text-emerald-100">
            Valor economizado por dia (R$)
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={dailySave}
            onChange={(e) => setDailySave(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-lg bg-white text-slate-900 text-base font-bold font-mono-num"
          />
          <div className="flex flex-wrap gap-2">
            {[5, 10, 20, 35].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDailySave(String(preset))}
                className="px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-xs font-mono-num cursor-pointer"
              >
                R$ {preset}/dia
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Practical Family Guidance Pillars */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">
          Sugestões práticas para a vida financeira da família
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              title: 'Economizar nas compras',
              body: 'Planejem o cardápio semanal em casal antes de ir ao mercado e comparem os gastos com alimentos e açougue mês a mês.',
            },
            {
              title: 'Reduzir gastos desnecessários',
              body: 'Revisem assinaturas digitais e pequenas compras por impulso juntas no final de cada mês para redirecionar para metas da casa.',
            },
            {
              title: 'Organizar pagamentos',
              body: 'Mantenham todas as contas fixas cadastradas com lembretes de vencimento para evitar multas e juros evitáveis.',
            },
            {
              title: 'Criar uma reserva',
              body: 'Separem primeiro um valor fixo no Nosso Cofrinho logo ao receber o salário, mesmo que comece pequeno.',
            },
            {
              title: 'Quitar dívidas com paz',
              body: 'Usem o Planejador de Dívidas para priorizar compromissos com maior juros ou menor saldo e celebrar cada parcela paga.',
            },
            {
              title: 'Melhorar o planejamento familiar',
              body: 'Façam uma conversa rápida de 15 minutos por semana para alinhar os objetivos e manter a transparência entre marido e esposa.',
            },
          ].map((guide) => (
            <div
              key={guide.title}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5"
            >
              <h3 className="text-sm font-bold text-slate-900">{guide.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{guide.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
