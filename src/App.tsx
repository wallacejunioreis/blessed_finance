import React, { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarCheck2,
  CheckCircle2,
  History,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  Menu,
  PieChart,
  PiggyBank,
  Plus,
  Target,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { DebtsView } from './components/DebtsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExpensesView } from './components/ExpensesView';
import { FamilySettingsView } from './components/FamilySettingsView';
import { FamilySetupScreen, FirstAccessWizard } from './components/FamilySetupScreen';
import { FixedBillsView } from './components/FixedBillsView';
import { HistoryView } from './components/HistoryView';
import { IncomesView } from './components/IncomesView';
import { IntelligenceView } from './components/IntelligenceView';
import { PlanningView } from './components/PlanningView';
import { PowerBIView } from './components/PowerBIView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAStatusBanner';
import { QuickTransactionModal } from './components/QuickTransactionModal';
import { ReportsView } from './components/ReportsView';
import { ReserveView } from './components/ReserveView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { FinanceProvider } from './contexts/FinanceContext';
import { AppRoute, ROLE_LABELS } from './types/finance';

interface NavItem {
  id: AppRoute;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Início', icon: LayoutDashboard },
  { id: 'receitas', label: 'Receitas', shortLabel: 'Receitas', icon: ArrowUpRight },
  { id: 'despesas', label: 'Despesas', shortLabel: 'Despesas', icon: ArrowDownRight },
  { id: 'contas_fixas', label: 'Contas Fixas', shortLabel: 'Fixas', icon: CalendarCheck2 },
  { id: 'dividas', label: 'Minhas Dívidas', shortLabel: 'Dívidas', icon: Landmark },
  { id: 'reserva', label: 'Nossa Reserva', shortLabel: 'Cofrinho', icon: PiggyBank },
  { id: 'planejamento', label: 'Planejamento', shortLabel: 'Planos', icon: Target },
  { id: 'inteligencia', label: 'Inteligência Financeira', shortLabel: 'Dicas', icon: Lightbulb },
  { id: 'relatorios', label: 'Relatórios', shortLabel: 'Relatórios', icon: BarChart3 },
  { id: 'power_bi', label: 'Power BI Local', shortLabel: 'Power BI', icon: PieChart },
  { id: 'historico', label: 'Histórico', shortLabel: 'Histórico', icon: History },
  { id: 'familia', label: 'Família e Segurança', shortLabel: 'Família', icon: Users },
];

const MOBILE_PRIMARY_IDS: AppRoute[] = ['dashboard', 'despesas', 'receitas', 'reserva'];

function AppShell() {
  const {
    user,
    authReady,
    profile,
    profileLoading,
    family,
  } = useAuth();

  const [route, setRoute] = useState<AppRoute>('dashboard');
  const [quickModal, setQuickModal] = useState<{ open: boolean; type: 'despesa' | 'receita' }>({
    open: false,
    type: 'despesa',
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<string>('');

  const notify = (msg: string) => {
    setToast(msg);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!authReady || (user && profileLoading)) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-[#0D3B2E] text-[#E6C778] font-bold flex items-center justify-center mx-auto font-display">
            BF
          </div>
          <p className="text-sm font-medium text-slate-600">
            Carregando Blessed Finance...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <OfflineIndicator />
        <AuthScreen />
      </>
    );
  }

  if (!profile?.familyId || !family) {
    return (
      <>
        <OfflineIndicator />
        <FamilySetupScreen />
      </>
    );
  }

  if (!profile.onboardingCompleted) {
    return (
      <>
        <OfflineIndicator />
        <FirstAccessWizard />
      </>
    );
  }

  const currentNav = NAV_ITEMS.find((n) => n.id === route) || NAV_ITEMS[0];

  const handleNavigate = (next: AppRoute) => {
    setRoute(next);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="px-5 py-5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#0D3B2E] text-[#E6C778] font-bold flex items-center justify-center text-sm font-display shrink-0">
            BF
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-900 font-display truncate">
              Blessed Finance
            </p>
            <p className="text-xs text-slate-500 truncate">{family.name}</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#0D3B2E] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100 text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-900 truncate">{profile.displayName}</p>
          <p className="text-slate-500">
            {ROLE_LABELS[profile.role] || 'Familiar'} · {family.name}
          </p>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 pb-20 lg:pb-8">
        <OfflineIndicator />
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="lg:hidden w-8 h-8 rounded-lg bg-[#0D3B2E] text-[#E6C778] font-bold flex items-center justify-center text-xs font-display shrink-0">
              BF
            </div>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 truncate max-w-[140px]">
                {family.name}
              </span>
              <span className="hidden sm:inline text-slate-300">/</span>
              <span className="font-semibold text-slate-900 truncate">{currentNav.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => setQuickModal({ open: true, type: 'despesa' })}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0D3B2E] text-white text-xs sm:text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Novo lançamento
            </button>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={route}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {route === 'dashboard' && (
                <DashboardView
                  onNavigate={handleNavigate}
                  onQuickAdd={(type) => setQuickModal({ open: true, type })}
                />
              )}
              {route === 'receitas' && <IncomesView onNotify={notify} />}
              {route === 'despesas' && <ExpensesView onNotify={notify} />}
              {route === 'contas_fixas' && <FixedBillsView onNotify={notify} />}
              {route === 'dividas' && <DebtsView onNotify={notify} />}
              {route === 'reserva' && <ReserveView onNotify={notify} />}
              {route === 'planejamento' && <PlanningView onNotify={notify} />}
              {route === 'inteligencia' && <IntelligenceView />}
              {route === 'relatorios' && <ReportsView />}
              {route === 'power_bi' && <PowerBIView onNotify={notify} />}
              {route === 'historico' && <HistoryView onNotify={notify} />}
              {route === 'familia' && <FamilySettingsView onNotify={notify} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Navegação principal móvel"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 grid grid-cols-5 h-16"
      >
        {MOBILE_PRIMARY_IDS.map((id) => {
          const item = NAV_ITEMS.find((n) => n.id === id)!;
          const Icon = item.icon;
          const active = route === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavigate(item.id)}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
                active ? 'text-[#0D3B2E] font-semibold' : 'text-slate-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="truncate max-w-[68px]">{item.shortLabel}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            mobileMenuOpen || !MOBILE_PRIMARY_IDS.includes(route)
              ? 'text-[#0D3B2E] font-semibold'
              : 'text-slate-500'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span>Mais</span>
        </button>
      </nav>

      {/* Mobile Full Menu Sheet */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/45 flex items-end">
          <div className="w-full bg-white rounded-t-2xl p-5 pb-8 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="text-base font-bold text-slate-900">Menu completo</p>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = route === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-left text-xs font-semibold cursor-pointer ${
                      active
                        ? 'bg-[#0D3B2E] text-white border-[#0D3B2E]'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Quick Transaction Modal */}
      <QuickTransactionModal
        open={quickModal.open}
        initialType={quickModal.type}
        onClose={() => setQuickModal((s) => ({ ...s, open: false }))}
        onSuccess={notify}
      />

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-50 bg-[#0D3B2E] text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2.5 text-xs sm:text-sm font-medium max-w-sm"
        >
          <CheckCircle2 className="w-4 h-4 text-[#E6C778] shrink-0" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <FinanceProvider>
          <AppShell />
        </FinanceProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
