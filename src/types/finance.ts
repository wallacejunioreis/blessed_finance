export type FamilyRole = 'marido' | 'esposa' | 'familiar';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: FamilyRole;
  familyId: string | null;
  onboardingCompleted: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Family {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FamilyMember {
  uid: string;
  displayName: string;
  role: FamilyRole;
  inviteCode?: string;
  joinedAt?: string;
}

export interface Income {
  id: string;
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD
  category: string;
  responsibleName: string;
  responsibleUid?: string;
  notes?: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  subcategory: string;
  amount: number;
  date: string; // YYYY-MM-DD
  paymentMethod: string;
  responsibleName: string;
  responsibleUid?: string;
  notes?: string;
  status: 'pago' | 'pendente';
  isInstallment: boolean;
  installmentGroupId?: string;
  installmentNumber?: number;
  totalInstallments?: number;
  isRecurring: boolean;
  fixedBillId?: string;
  referenceMonth?: string; // YYYY-MM
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
  updatedAt?: string;
}

export type BillFrequency = 'mensal' | 'bimestral' | 'trimestral' | 'anual';

export interface FixedBill {
  id: string;
  name: string;
  expectedAmount: number;
  dueDay: number;
  frequency: BillFrequency;
  category: string;
  subcategory: string;
  lastPaidMonth: string; // YYYY-MM or ''
  lastPaidDate: string; // YYYY-MM-DD or ''
  lastPaidAmount: number;
  active: boolean;
  notes?: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Debt {
  id: string;
  name: string;
  creditor: string;
  originalAmount: number;
  currentAmount: number;
  installmentAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  interestRate: number;
  dueDate: string; // YYYY-MM-DD
  status: 'ativa' | 'quitada';
  notes?: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  debtName: string;
  amount: number;
  date: string; // YYYY-MM-DD
  paymentType: 'parcela' | 'parcial' | 'quitacao';
  notes?: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
}

export interface ReserveGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  notes?: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReserveMovement {
  id: string;
  goalId: string;
  goalName: string;
  type: 'deposito' | 'retirada';
  amount: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
}

export interface Budget {
  id: string;
  category: string;
  monthlyLimit: number;
  month: string; // 'padrao' or 'YYYY-MM'
  createdByUid: string;
  createdByName: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  action: 'criar' | 'editar' | 'excluir' | 'pagamento' | 'reserva';
  entityType: string;
  entityId: string;
  summary: string;
  amount?: number;
  performedByUid: string;
  performedByName: string;
  createdAt?: string;
}

export type PeriodFilterKey =
  | 'mes_atual'
  | 'mes_anterior'
  | 'ultimos_3_meses'
  | 'ultimos_6_meses'
  | 'ano_atual'
  | 'personalizado';

export interface PeriodFilter {
  key: PeriodFilterKey;
  startDate: string;
  endDate: string;
}

export type AppRoute =
  | 'dashboard'
  | 'receitas'
  | 'despesas'
  | 'contas_fixas'
  | 'dividas'
  | 'reserva'
  | 'planejamento'
  | 'inteligencia'
  | 'relatorios'
  | 'power_bi'
  | 'historico'
  | 'familia';

export const INCOME_CATEGORIES: string[] = [
  'Salário do marido',
  'Salário da esposa',
  'Renda extra',
  'Trabalho por fora',
  'Comissões',
  'Bonificações',
  'Vendas',
  'Outros recebimentos',
];

export interface ExpenseCategoryGroup {
  code: string;
  label: string;
  subcategories: string[];
}

export const EXPENSE_CATEGORIES: ExpenseCategoryGroup[] = [
  {
    code: 'A',
    label: 'Compras de Casa',
    subcategories: [
      'Supermercado',
      'Compras de alimentos',
      'Carne',
      'Açougue',
      'Frutas',
      'Verduras e legumes',
      'Padaria',
      'Produtos de limpeza',
      'Produtos de higiene',
      'Outros gastos domésticos',
    ],
  },
  {
    code: 'B',
    label: 'Contas da Casa',
    subcategories: [
      'Energia elétrica',
      'Água',
      'Internet',
      'Telefone',
      'Gás',
      'Aluguel',
      'Financiamento',
      'Condomínio',
      'Outras contas',
    ],
  },
  {
    code: 'C',
    label: 'Transporte',
    subcategories: [
      'Combustível',
      'Transporte público',
      'Aplicativos de transporte',
      'Manutenção do veículo',
      'Seguro',
      'Estacionamento',
    ],
  },
  {
    code: 'D',
    label: 'Saúde',
    subcategories: [
      'Farmácia',
      'Consultas',
      'Exames',
      'Plano de saúde',
      'Outros gastos com saúde',
    ],
  },
  {
    code: 'E',
    label: 'Despesas Pessoais',
    subcategories: [
      'Roupas',
      'Calçados',
      'Academia',
      'Cuidados pessoais',
      'Lazer',
      'Restaurantes',
      'Assinaturas',
    ],
  },
  {
    code: 'F',
    label: 'Família',
    subcategories: [
      'Crianças',
      'Educação',
      'Material escolar',
      'Presentes',
      'Atividades familiares',
    ],
  },
  {
    code: 'G',
    label: 'Igreja e Solidariedade',
    subcategories: [
      'Dízimos',
      'Ofertas',
      'Doações',
      'Ações solidárias',
    ],
  },
  {
    code: 'H',
    label: 'Outras Despesas',
    subcategories: [
      'Emergências',
      'Manutenção da casa',
      'Imprevistos',
      'Outros',
    ],
  },
];

export const PAYMENT_METHODS: string[] = [
  'PIX',
  'Cartão de Débito',
  'Cartão de Crédito',
  'Dinheiro',
  'Transferência',
  'Boleto',
];

export const PLANNING_CATEGORIES: string[] = [
  'Supermercado',
  'Carne',
  'Energia elétrica',
  'Água',
  'Internet',
  'Telefone',
  'Transporte',
  'Lazer',
  'Reserva',
  'Compras de Casa',
  'Contas da Casa',
  'Saúde',
  'Despesas Pessoais',
  'Família',
  'Igreja e Solidariedade',
  'Outras Despesas',
];

export const MAX_LENGTHS = {
  displayName: 80,
  email: 150,
  familyName: 80,
  description: 140,
  category: 60,
  subcategory: 60,
  paymentMethod: 40,
  notes: 500,
  billName: 100,
  debtName: 100,
  creditor: 100,
  goalName: 100,
  summary: 240,
};

export const ROLE_LABELS: Record<FamilyRole, string> = {
  marido: 'Marido',
  esposa: 'Esposa',
  familiar: 'Familiar',
};
