// Planos e situação da assinatura do SaaS (somente Admin Geral).
// Datas "YYYY-MM-DD" no fuso do negócio; meses de referência "YYYY-MM-01".

export const plans = {
  trial: { label: "Teste grátis", paid: false },
  basico: { label: "Básico", paid: true },
  profissional: { label: "Profissional", paid: true },
  isento: { label: "Isento", paid: false },
} as const;
export type PlanId = keyof typeof plans;
export const planIds = Object.keys(plans) as PlanId[];

export const paymentMethods = {
  pix: "Pix",
  boleto: "Boleto",
  cartao: "Cartão",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
} as const;
export type PaymentMethod = keyof typeof paymentMethods;

export type Billing = {
  plan: PlanId;
  monthly_price_cents: number;
  due_day: number;
  trial_ends_at: string | null;
};

export type BillingStatus = {
  key: "teste" | "teste_encerrado" | "em_dia" | "em_atraso" | "isento";
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  /** Mês de referência que deveria estar pago (planos pagos). */
  dueMonth?: string;
};

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Mês anterior a "YYYY-MM-01". */
export function previousMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * Situação da assinatura em `today`.
 * Plano pago: a mensalidade do mês vence no `due_day`; antes disso, a cobrança em aberto é a do mês anterior.
 * Meses anteriores à criação do estabelecimento não contam.
 */
export function billingStatus(b: Billing, paidMonths: string[], today: string, createdAt: string): BillingStatus {
  if (b.plan === "isento") return { key: "isento", label: "Isento", tone: "neutral" };
  if (b.plan === "trial") {
    if (b.trial_ends_at && today <= b.trial_ends_at) return { key: "teste", label: `Em teste até ${br(b.trial_ends_at)}`, tone: "info" };
    return { key: "teste_encerrado", label: "Teste encerrado", tone: "warning" };
  }

  const thisMonth = `${today.slice(0, 7)}-01`;
  const dueMonth = Number(today.slice(8, 10)) >= b.due_day ? thisMonth : previousMonth(thisMonth);
  const firstMonth = `${createdAt.slice(0, 7)}-01`;
  if (dueMonth < firstMonth || paidMonths.includes(dueMonth)) {
    return { key: "em_dia", label: "Em dia", tone: "success", dueMonth };
  }
  return { key: "em_atraso", label: `Em atraso (${monthLabel(dueMonth)})`, tone: "danger", dueMonth };
}

/** Receita mensal recorrente: planos pagos de estabelecimentos ativos. */
export function monthlyRecurringRevenue(rows: { status: string; billing: Billing | null }[]) {
  return rows.reduce((sum, r) => (r.status === "active" && r.billing && plans[r.billing.plan].paid ? sum + r.billing.monthly_price_cents : sum), 0);
}
