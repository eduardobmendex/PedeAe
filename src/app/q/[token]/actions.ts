"use server";

import { couponCodeSchema, couponErrorMessage, orderErrorMessage, orderPayloadSchema, type PlaceOrderResult } from "@/lib/orders";
import { paymentsConfigured } from "@/lib/payments/service";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Envia o pedido do cliente. Roda como visitante anônimo: o banco valida o QR
 * Code, recalcula preços e aplica idempotência e limite de pedidos por mesa.
 */
export async function placeCustomerOrder(tableToken: string, payload: unknown): Promise<PlaceOrderResult> {
  if (!/^[0-9a-f]{24}$/.test(tableToken)) return { ok: false, error: "QR Code inválido." };
  const parsed = orderPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { data, error } = await createPublicClient().rpc("create_customer_order", {
    p_table_token: tableToken,
    p_items: parsed.data.items,
    p_customer_name: parsed.data.customerName,
    p_notes: parsed.data.notes,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_coupon_code: parsed.data.couponCode ?? null,
    p_prepay: parsed.data.prepay === true && paymentsConfigured(),
  });
  if (error) return { ok: false, ...orderErrorMessage(error.message) };

  const result = data as { public_token: string; order_number: number; payment_token?: string | null };
  return { ok: true, publicToken: result.public_token, orderNumber: result.order_number, paymentToken: result.payment_token ?? undefined };
}

const TOKEN = /^[0-9a-f]{24}$/;

export type CouponPreview = { ok: true; code: string; discountCents: number; label: string } | { ok: false; error: string };

/** Confere o cupom para o subtotal atual do carrinho (o valor final é recalculado no pedido). */
export async function previewCoupon(tableToken: string, code: string, subtotalCents: number): Promise<CouponPreview> {
  if (!TOKEN.test(tableToken)) return { ok: false, error: "QR Code inválido." };
  const parsed = couponCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, error: "Cupom inválido." };
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) return { ok: false, error: "Carrinho inválido." };

  const { data, error } = await createPublicClient().rpc("check_coupon", {
    p_table_token: tableToken,
    p_code: parsed.data,
    p_subtotal_cents: subtotalCents,
  });
  if (error) return { ok: false, error: couponErrorMessage(error.message) ?? "Não foi possível validar o cupom." };
  const c = data as { code: string; discount_cents: number; kind: string; value: number; description: string | null };
  const label = c.description || (c.kind === "percent" ? `${c.value}% de desconto` : "Desconto");
  return { ok: true, code: c.code, discountCents: c.discount_cents, label };
}

export type ServiceCallResult = { ok: true; tabTotalCents: number } | { ok: false; error: string };

/** Chamar garçom ou pedir a conta pela mesa. */
export async function callService(tableToken: string, kind: "waiter" | "bill"): Promise<ServiceCallResult> {
  if (!TOKEN.test(tableToken) || (kind !== "waiter" && kind !== "bill")) return { ok: false, error: "QR Code inválido." };
  const { data, error } = await createPublicClient().rpc("call_service", { p_table_token: tableToken, p_kind: kind });
  if (error) {
    return { ok: false, error: error.message.includes("table_invalid") ? "Este QR Code não está mais ativo." : "Não foi possível chamar agora. Tente de novo." };
  }
  return { ok: true, tabTotalCents: (data as { tab_total_cents: number }).tab_total_cents };
}

export type TabPaymentStart = { ok: true; token: string } | { ok: false; error: string };

/** Cliente da mesa paga a conta online (toda ou uma parte), com ou sem a taxa de serviço. */
export async function startTabPayment(tableToken: string, amountCents: number | null, includeServiceFee: boolean): Promise<TabPaymentStart> {
  if (!TOKEN.test(tableToken)) return { ok: false, error: "QR Code inválido." };
  if (!paymentsConfigured()) return { ok: false, error: "Pagamento online indisponível agora." };
  if (amountCents !== null && (!Number.isInteger(amountCents) || amountCents < 100)) return { ok: false, error: "Valor mínimo: R$ 1,00." };
  const { data, error } = await createPublicClient().rpc("create_tab_payment_intent", {
    p_table_token: tableToken,
    p_amount_cents: amountCents,
    p_include_service_fee: includeServiceFee,
  });
  if (error) {
    if (error.message.includes("tab_empty")) return { ok: false, error: "Não há nada a pagar nesta mesa agora." };
    if (error.message.includes("invalid_amount")) return { ok: false, error: "O valor é maior do que falta pagar na mesa." };
    if (error.message.includes("online_payments_disabled")) return { ok: false, error: "Este estabelecimento não está recebendo pagamentos online." };
    return { ok: false, error: "Não foi possível iniciar o pagamento. Tente de novo." };
  }
  return { ok: true, token: (data as { token: string }).token };
}
