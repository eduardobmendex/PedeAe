// Conta da mesa: cálculo exibido no painel. O banco refaz a conta ao fechar (close_tab).

export const paymentMethods = {
  dinheiro: "Dinheiro",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  pix: "Pix",
} as const;
export type TabPaymentMethod = keyof typeof paymentMethods;
export const isTabPaymentMethod = (v: unknown): v is TabPaymentMethod => typeof v === "string" && v in paymentMethods;

export const DEFAULT_SERVICE_FEE = 10;
export const MAX_SERVICE_FEE = 30;

/** Pedidos que entram na conta: tudo menos cancelado/recusado. */
export const countsInTab = (status: string) => status !== "cancelled" && status !== "rejected";

export type TabTotals = {
  subtotalCents: number;
  serviceFeeCents: number;
  totalCents: number;
  paidCents: number;
  /** Quanto falta pagar (0 se já pago). */
  remainingCents: number;
  /** Pago a mais (troco a devolver ou gorjeta). */
  overpaidCents: number;
};

export function computeTab(orderTotals: number[], paymentAmounts: number[], feePercent: number): TabTotals {
  const subtotalCents = orderTotals.reduce((n, v) => n + v, 0);
  const serviceFeeCents = Math.round((subtotalCents * feePercent) / 100);
  const totalCents = subtotalCents + serviceFeeCents;
  const paidCents = paymentAmounts.reduce((n, v) => n + v, 0);
  return {
    subtotalCents,
    serviceFeeCents,
    totalCents,
    paidCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    overpaidCents: Math.max(0, paidCents - totalCents),
  };
}

/**
 * Divide um valor entre N pessoas sem perder centavos: as primeiras pagam 1 centavo a mais.
 * 100,00 / 3 → [33,34; 33,33; 33,33].
 */
export function splitEvenly(totalCents: number, people: number): number[] {
  const n = Math.max(1, Math.min(50, Math.floor(people)));
  const base = Math.floor(totalCents / n);
  const extra = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Dinheiro: registra no máximo o que falta; o resto é troco. */
export function cashPayment(receivedCents: number, remainingCents: number) {
  const applied = Math.min(receivedCents, remainingCents);
  return { appliedCents: applied, changeCents: Math.max(0, receivedCents - applied) };
}

export function tabErrorMessage(message: string): string {
  if (message.includes("tab_not_paid")) return "Ainda falta receber parte da conta.";
  if (message.includes("tab_has_active_orders")) return "Há pedidos em andamento nesta mesa. Marque-os como entregues (ou cancele) antes de fechar.";
  if (message.includes("tab_closed")) return "Esta conta já foi fechada.";
  if (message.includes("invalid_fee")) return `Taxa de serviço deve ficar entre 0% e ${MAX_SERVICE_FEE}%.`;
  if (message.includes("forbidden")) return "Você não tem permissão para esta ação.";
  return "Não foi possível concluir. Tente novamente.";
}
