import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, subscribeFamilyEvents } from '../services/api';
import {
  AuditLog,
  BillFrequency,
  Budget,
  Debt,
  DebtPayment,
  Expense,
  FixedBill,
  Income,
  ReserveGoal,
  ReserveMovement,
} from '../types/finance';
import { FamilyBackupData } from '../utils/exportReports';
import { useAuth } from './AuthContext';

export interface IncomeInput {
  description: string;
  amount: number;
  date: string;
  category: string;
  responsibleName: string;
  responsibleUid?: string;
  notes?: string;
}

export interface ExpenseInput {
  description: string;
  category: string;
  subcategory: string;
  amount: number;
  date: string;
  paymentMethod: string;
  responsibleName: string;
  responsibleUid?: string;
  notes?: string;
  status: 'pago' | 'pendente';
  installments?: number;
  isRecurring?: boolean;
}

export interface FixedBillInput {
  name: string;
  expectedAmount: number;
  dueDay: number;
  frequency: BillFrequency;
  category: string;
  subcategory: string;
  active?: boolean;
  notes?: string;
}

export interface DebtInput {
  name: string;
  creditor: string;
  originalAmount: number;
  currentAmount: number;
  installmentAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  interestRate: number;
  dueDate: string;
  notes?: string;
}

export interface ReserveGoalInput {
  name: string;
  targetAmount: number;
  monthlyContribution: number;
  notes?: string;
}

interface FinanceSnapshot {
  incomes: Income[];
  expenses: Expense[];
  fixedBills: FixedBill[];
  debts: Debt[];
  debtPayments: DebtPayment[];
  reserves: ReserveGoal[];
  reserveMovements: ReserveMovement[];
  budgets: Budget[];
  auditLogs: AuditLog[];
}

interface FinanceContextValue {
  loading: boolean;
  incomes: Income[];
  expenses: Expense[];
  fixedBills: FixedBill[];
  debts: Debt[];
  debtPayments: DebtPayment[];
  reserves: ReserveGoal[];
  reserveMovements: ReserveMovement[];
  budgets: Budget[];
  auditLogs: AuditLog[];

  addIncome: (input: IncomeInput) => Promise<void>;
  updateIncome: (id: string, input: IncomeInput) => Promise<void>;
  deleteIncome: (income: Income) => Promise<void>;

  addExpense: (input: ExpenseInput) => Promise<void>;
  updateExpense: (
    id: string,
    input: Omit<ExpenseInput, 'installments' | 'isRecurring'>
  ) => Promise<void>;
  toggleExpenseStatus: (expense: Expense) => Promise<void>;
  deleteExpense: (expense: Expense) => Promise<void>;

  addFixedBill: (input: FixedBillInput) => Promise<void>;
  updateFixedBill: (id: string, input: FixedBillInput) => Promise<void>;
  payFixedBill: (params: {
    bill: FixedBill;
    paidAmount: number;
    paidDate: string;
    paymentMethod: string;
  }) => Promise<void>;
  deleteFixedBill: (bill: FixedBill) => Promise<void>;

  addDebt: (input: DebtInput) => Promise<void>;
  updateDebt: (id: string, input: DebtInput) => Promise<void>;
  payDebt: (params: {
    debt: Debt;
    amount: number;
    date: string;
    paymentType: 'parcela' | 'parcial' | 'quitacao';
    recordAsExpense: boolean;
    paymentMethod?: string;
    notes?: string;
  }) => Promise<void>;
  deleteDebt: (debt: Debt) => Promise<void>;

  addReserveGoal: (input: ReserveGoalInput) => Promise<void>;
  updateReserveGoal: (id: string, input: ReserveGoalInput) => Promise<void>;
  moveReserve: (params: {
    goal: ReserveGoal;
    type: 'deposito' | 'retirada';
    amount: number;
    date: string;
    notes?: string;
  }) => Promise<void>;
  deleteReserveGoal: (goal: ReserveGoal) => Promise<void>;

  saveBudget: (params: { category: string; monthlyLimit: number; existingId?: string }) => Promise<void>;
  deleteBudget: (budget: Budget) => Promise<void>;

  restoreBackup: (backup: FamilyBackupData, currentPassword: string) => Promise<number>;
}

const FinanceContext = createContext<FinanceContextValue | undefined>(undefined);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const { user, authReady, family, refreshSessionState } = useAuth();
  const [loading, setLoading] = useState(true);

  const [incomes, setIncomes] = useState<Income[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fixedBills, setFixedBills] = useState<FixedBill[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);
  const [reserves, setReserves] = useState<ReserveGoal[]>([]);
  const [reserveMovements, setReserveMovements] = useState<ReserveMovement[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const familyId = family?.id ?? null;

  const applySnapshot = useCallback((snap: FinanceSnapshot) => {
    setIncomes(snap.incomes);
    setExpenses(snap.expenses);
    setFixedBills(snap.fixedBills);
    setDebts(snap.debts);
    setDebtPayments(snap.debtPayments);
    setReserves(snap.reserves);
    setReserveMovements(snap.reserveMovements);
    setBudgets(snap.budgets);
    setAuditLogs(snap.auditLogs);
  }, []);

  const fetchSnapshot = useCallback(async () => {
    if (!familyId) return;
    const snap = await apiRequest<FinanceSnapshot>('/api/finance/snapshot');
    applySnapshot(snap);
  }, [familyId, applySnapshot]);

  useEffect(() => {
    if (!authReady || !user || !familyId) {
      setIncomes([]);
      setExpenses([]);
      setFixedBills([]);
      setDebts([]);
      setDebtPayments([]);
      setReserves([]);
      setReserveMovements([]);
      setBudgets([]);
      setAuditLogs([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetchSnapshot()
      .catch(() => {
        // handled by AuthContext on 401
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Real-time synchronization via Server-Sent Events when another family member updates data
    const unsubEvents = subscribeFamilyEvents((scope) => {
      if (scope === 'family') {
        void refreshSessionState();
      } else {
        void fetchSnapshot();
      }
    });

    const onFocus = () => {
      void fetchSnapshot();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      unsubEvents();
      window.removeEventListener('focus', onFocus);
    };
  }, [authReady, user, familyId, fetchSnapshot, refreshSessionState]);

  // --- INCOMES ---
  const addIncome = async (input: IncomeInput) => {
    const snap = await apiRequest<FinanceSnapshot>('/api/finance/incomes', {
      method: 'POST',
      body: input,
    });
    applySnapshot(snap);
  };

  const updateIncome = async (id: string, input: IncomeInput) => {
    const snap = await apiRequest<FinanceSnapshot>(`/api/finance/incomes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: input,
    });
    applySnapshot(snap);
  };

  const deleteIncome = async (income: Income) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/incomes/${encodeURIComponent(income.id)}`,
      { method: 'DELETE' }
    );
    applySnapshot(snap);
  };

  // --- EXPENSES ---
  const addExpense = async (input: ExpenseInput) => {
    const snap = await apiRequest<FinanceSnapshot>('/api/finance/expenses', {
      method: 'POST',
      body: input,
    });
    applySnapshot(snap);
  };

  const updateExpense = async (
    id: string,
    input: Omit<ExpenseInput, 'installments' | 'isRecurring'>
  ) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/expenses/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: input,
      }
    );
    applySnapshot(snap);
  };

  const toggleExpenseStatus = async (expense: Expense) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/expenses/${encodeURIComponent(expense.id)}/toggle`,
      { method: 'PATCH' }
    );
    applySnapshot(snap);
  };

  const deleteExpense = async (expense: Expense) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/expenses/${encodeURIComponent(expense.id)}`,
      { method: 'DELETE' }
    );
    applySnapshot(snap);
  };

  // --- FIXED BILLS ---
  const addFixedBill = async (input: FixedBillInput) => {
    const snap = await apiRequest<FinanceSnapshot>('/api/finance/fixed-bills', {
      method: 'POST',
      body: input,
    });
    applySnapshot(snap);
  };

  const updateFixedBill = async (id: string, input: FixedBillInput) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/fixed-bills/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: input,
      }
    );
    applySnapshot(snap);
  };

  const payFixedBill = async ({
    bill,
    paidAmount,
    paidDate,
    paymentMethod,
  }: {
    bill: FixedBill;
    paidAmount: number;
    paidDate: string;
    paymentMethod: string;
  }) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/fixed-bills/${encodeURIComponent(bill.id)}/pay`,
      {
        method: 'POST',
        body: { paidAmount, paidDate, paymentMethod },
      }
    );
    applySnapshot(snap);
  };

  const deleteFixedBill = async (bill: FixedBill) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/fixed-bills/${encodeURIComponent(bill.id)}`,
      { method: 'DELETE' }
    );
    applySnapshot(snap);
  };

  // --- DEBTS ---
  const addDebt = async (input: DebtInput) => {
    const snap = await apiRequest<FinanceSnapshot>('/api/finance/debts', {
      method: 'POST',
      body: input,
    });
    applySnapshot(snap);
  };

  const updateDebt = async (id: string, input: DebtInput) => {
    const snap = await apiRequest<FinanceSnapshot>(`/api/finance/debts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: input,
    });
    applySnapshot(snap);
  };

  const payDebt = async ({
    debt,
    amount,
    date,
    paymentType,
    recordAsExpense,
    paymentMethod,
    notes,
  }: {
    debt: Debt;
    amount: number;
    date: string;
    paymentType: 'parcela' | 'parcial' | 'quitacao';
    recordAsExpense: boolean;
    paymentMethod?: string;
    notes?: string;
  }) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/debts/${encodeURIComponent(debt.id)}/pay`,
      {
        method: 'POST',
        body: { amount, date, paymentType, recordAsExpense, paymentMethod, notes },
      }
    );
    applySnapshot(snap);
  };

  const deleteDebt = async (debt: Debt) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/debts/${encodeURIComponent(debt.id)}`,
      { method: 'DELETE' }
    );
    applySnapshot(snap);
  };

  // --- RESERVES ---
  const addReserveGoal = async (input: ReserveGoalInput) => {
    const snap = await apiRequest<FinanceSnapshot>('/api/finance/reserves', {
      method: 'POST',
      body: input,
    });
    applySnapshot(snap);
  };

  const updateReserveGoal = async (id: string, input: ReserveGoalInput) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/reserves/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: input,
      }
    );
    applySnapshot(snap);
  };

  const moveReserve = async ({
    goal,
    type,
    amount,
    date,
    notes,
  }: {
    goal: ReserveGoal;
    type: 'deposito' | 'retirada';
    amount: number;
    date: string;
    notes?: string;
  }) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/reserves/${encodeURIComponent(goal.id)}/move`,
      {
        method: 'POST',
        body: { type, amount, date, notes },
      }
    );
    applySnapshot(snap);
  };

  const deleteReserveGoal = async (goal: ReserveGoal) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/reserves/${encodeURIComponent(goal.id)}`,
      { method: 'DELETE' }
    );
    applySnapshot(snap);
  };

  // --- BUDGETS ---
  const saveBudget = async ({
    category,
    monthlyLimit,
    existingId,
  }: {
    category: string;
    monthlyLimit: number;
    existingId?: string;
  }) => {
    const snap = await apiRequest<FinanceSnapshot>('/api/finance/budgets', {
      method: 'POST',
      body: { category, monthlyLimit, existingId },
    });
    applySnapshot(snap);
  };

  const deleteBudget = async (budget: Budget) => {
    const snap = await apiRequest<FinanceSnapshot>(
      `/api/finance/budgets/${encodeURIComponent(budget.id)}`,
      { method: 'DELETE' }
    );
    applySnapshot(snap);
  };

  // --- BACKUP RESTORE ---
  const restoreBackup = async (
    backup: FamilyBackupData,
    currentPassword: string
  ): Promise<number> => {
    const res = await apiRequest<{ restoredCount: number; snapshot: FinanceSnapshot }>(
      '/api/finance/restore-backup',
      {
        method: 'POST',
        body: { backup, currentPassword },
      }
    );
    applySnapshot(res.snapshot);
    return res.restoredCount;
  };

  return (
    <FinanceContext.Provider
      value={{
        loading,
        incomes,
        expenses,
        fixedBills,
        debts,
        debtPayments,
        reserves,
        reserveMovements,
        budgets,
        auditLogs,
        addIncome,
        updateIncome,
        deleteIncome,
        addExpense,
        updateExpense,
        toggleExpenseStatus,
        deleteExpense,
        addFixedBill,
        updateFixedBill,
        payFixedBill,
        deleteFixedBill,
        addDebt,
        updateDebt,
        payDebt,
        deleteDebt,
        addReserveGoal,
        updateReserveGoal,
        moveReserve,
        deleteReserveGoal,
        saveBudget,
        deleteBudget,
        restoreBackup,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance deve ser usado dentro de FinanceProvider.');
  return ctx;
}
