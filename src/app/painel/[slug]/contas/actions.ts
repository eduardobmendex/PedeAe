"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getOrgContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { isTabPaymentMethod, MAX_SERVICE_FEE, tabErrorMessage } from "@/lib/tab";

export type TabActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/;

function refresh(slug: string, sessionId: string) {
  revalidatePath(`/painel/${slug}/contas`);
  revalidatePath(`/painel/${slug}/contas/${sessionId}`);
}

/** Registra um pagamento (parcial ou total) na conta da mesa. */
export async function recordPayment(slug: string, sessionId: string, amountCents: number, method: string): Promise<TabActionResult> {
  const { membership } = await getOrgContext(slug);
  if (!can(membership, "receive_payments")) return { ok: false, error: tabErrorMessage("forbidden") };
  if (!UUID.test(sessionId) || !isTabPaymentMethod(method)) return { ok: false, error: "Dados inválidos." };
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000) return { ok: false, error: "Valor inválido." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_tab_payment", { p_session_id: sessionId, p_amount_cents: amountCents, p_method: method });
  if (error) return { ok: false, error: tabErrorMessage(error.message) };
  refresh(slug, sessionId);
  return { ok: true };
}

export async function removePayment(slug: string, sessionId: string, paymentId: string): Promise<TabActionResult> {
  const { membership } = await getOrgContext(slug);
  if (!can(membership, "receive_payments")) return { ok: false, error: tabErrorMessage("forbidden") };
  if (!UUID.test(paymentId)) return { ok: false, error: "Dados inválidos." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_tab_payment", { p_payment_id: paymentId });
  if (error) return { ok: false, error: tabErrorMessage(error.message) };
  refresh(slug, sessionId);
  return { ok: true };
}

/** Fecha a conta (tudo pago e entregue) e libera a mesa. */
export async function closeTab(slug: string, sessionId: string, feePercent: number): Promise<TabActionResult> {
  const { membership } = await getOrgContext(slug);
  if (!can(membership, "close_tabs")) return { ok: false, error: tabErrorMessage("forbidden") };
  if (!UUID.test(sessionId)) return { ok: false, error: "Dados inválidos." };
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > MAX_SERVICE_FEE) return { ok: false, error: tabErrorMessage("invalid_fee") };

  const supabase = await createClient();
  const { error } = await supabase.rpc("close_tab", { p_session_id: sessionId, p_service_fee_percent: feePercent });
  if (error) return { ok: false, error: tabErrorMessage(error.message) };
  refresh(slug, sessionId);
  revalidatePath(`/painel/${slug}`);
  return { ok: true };
}

export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

/** Gera um link de pagamento online (Pix/cartão) para a conta, para mandar por WhatsApp. */
export async function createPaymentLink(slug: string, sessionId: string, amountCents: number): Promise<LinkResult> {
  const { membership } = await getOrgContext(slug);
  if (!can(membership, "receive_payments")) return { ok: false, error: tabErrorMessage("forbidden") };
  if (!UUID.test(sessionId) || !Number.isInteger(amountCents) || amountCents < 100) return { ok: false, error: "Valor mínimo: R$ 1,00." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_tab_payment_link", { p_session_id: sessionId, p_amount_cents: amountCents });
  if (error) {
    if (error.message.includes("online_payments_disabled")) return { ok: false, error: "Pagamento online não está ativo para este estabelecimento." };
    if (error.message.includes("invalid_amount")) return { ok: false, error: "O valor é maior do que falta pagar." };
    return { ok: false, error: tabErrorMessage(error.message) };
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return { ok: true, url: `${proto}://${host}/pagar/${(data as { token: string }).token}` };
}
