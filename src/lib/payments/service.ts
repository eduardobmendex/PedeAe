import "server-only";
import { updateTag } from "next/cache";
import { menuTag } from "@/lib/menu";
import { createAdminClient } from "@/lib/supabase/admin";
import { markSimulatedPaid, PagarmeError, paymentProvider, platformRecipientId, simulatorEnabled } from "./pagarme";
import { payerError, type BillingAddress, type Payer } from "./types";

// Orquestra os pagamentos online: cria a cobrança no Pagar.me, guarda o QR do Pix e confirma
// no banco quando o Pagar.me diz que foi pago. A confirmação SEMPRE consulta o Pagar.me
// (nunca confia só no que chega pelo navegador ou no corpo do webhook).

export type PayResult = { ok: true } | { ok: false; error: string };

type IntentRow = {
  id: string;
  organization_id: string;
  kind: "tab" | "order";
  amount_cents: number;
  status: string;
  method: string | null;
  provider_order_id: string | null;
  pix_expires_at: string | null;
  expires_at: string;
  organizations: { name: string; slug: string };
  organization_payment_settings?: unknown;
};

const PIX_SECONDS = 15 * 60;

/** Pagamento online pronto neste servidor (provedor + chave do Supabase para confirmar). */
export function paymentsConfigured() {
  return paymentProvider() !== null && createAdminClient() !== null;
}

async function loadIntent(token: string) {
  const db = createAdminClient();
  if (!db || !/^[0-9a-f]{32}$/.test(token)) return null;
  const { data } = await db
    .from("payment_intents")
    .select("id, organization_id, kind, amount_cents, status, method, provider_order_id, pix_expires_at, expires_at, organizations (name, slug)")
    .eq("public_token", token)
    .maybeSingle();
  return data as unknown as IntentRow | null;
}

async function splitFor(orgId: string) {
  const db = createAdminClient()!;
  const { data } = await db
    .from("organization_payment_settings")
    .select("enabled, pagarme_recipient_id, platform_fee_percent")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data?.enabled || !data.pagarme_recipient_id) return null;
  return { recipientId: data.pagarme_recipient_id as string, platformRecipientId: platformRecipientId(), platformFeePercent: data.platform_fee_percent as number };
}

function providerError(e: unknown) {
  if (e instanceof PagarmeError) {
    console.error("[pagarme]", e.status, JSON.stringify(e.details)?.slice(0, 800));
    if (e.status === 422 || e.status === 400) return "Dados recusados pelo meio de pagamento. Confira e tente de novo.";
    if (e.status === 401 || e.status === 403) return "Pagamento online mal configurado. Avise o estabelecimento.";
  } else console.error("[pagarme]", e);
  return "Não foi possível falar com o meio de pagamento agora. Tente de novo.";
}

async function startPayment(
  token: string,
  payer: Payer,
  method: { kind: "pix" } | { kind: "credit_card"; cardToken: string; billing: BillingAddress },
): Promise<PayResult> {
  const provider = paymentProvider();
  const db = createAdminClient();
  if (!provider || !db) return { ok: false, error: "Pagamento online indisponível no momento." };
  const invalid = payerError(payer);
  if (invalid) return { ok: false, error: invalid };

  const intent = await loadIntent(token);
  if (!intent) return { ok: false, error: "Pagamento não encontrado." };
  if (intent.status === "paid") return { ok: true };
  if (intent.status !== "pending" || new Date(intent.expires_at) < new Date()) return { ok: false, error: "Este pagamento expirou. Gere um novo." };
  // Pix já gerado e ainda válido: reaproveita (evita cobrança duplicada).
  if (method.kind === "pix" && intent.method === "pix" && intent.pix_expires_at && new Date(intent.pix_expires_at) > new Date()) return { ok: true };

  const split = await splitFor(intent.organization_id);
  if (!split) return { ok: false, error: "Este estabelecimento não está recebendo pagamentos online." };

  const description = `${intent.organizations.name} · ${intent.kind === "order" ? "Pedido" : "Conta da mesa"} (PedeAe)`;
  try {
    const order = await provider.createOrder({
      intentId: intent.id,
      organizationId: intent.organization_id,
      description,
      amountCents: intent.amount_cents,
      payer,
      split,
      ...(method.kind === "pix"
        ? { method: "pix" as const, pixExpiresInSeconds: PIX_SECONDS }
        : { method: "credit_card" as const, cardToken: method.cardToken, billing: method.billing }),
    });

    await db
      .from("payment_intents")
      .update({
        method: method.kind,
        provider: provider.name === "simulator" ? "simulator" : "pagarme",
        provider_order_id: order.id,
        pix_qr_code: order.pix?.qrCode ?? null,
        pix_qr_code_url: order.pix?.qrCodeUrl || null,
        pix_expires_at: order.pix?.expiresAt || null,
        failure_reason: order.failureReason ?? null,
        status: order.status === "failed" ? "failed" : "pending",
      })
      .eq("id", intent.id)
      .eq("status", "pending");

    if (order.status === "paid") await confirm(intent, order.id, method.kind, order.paidAmountCents);
    if (order.status === "failed") return { ok: false, error: order.failureReason ?? "Pagamento recusado." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: providerError(e) };
  }
}

export const payWithPix = (token: string, payer: Payer) => startPayment(token, payer, { kind: "pix" });
export const payWithCard = (token: string, payer: Payer, cardToken: string, billing: BillingAddress) =>
  startPayment(token, payer, { kind: "credit_card", cardToken, billing });

async function confirm(intent: Pick<IntentRow, "id" | "organizations">, providerOrderId: string, method: string, paidCents: number) {
  const db = createAdminClient()!;
  const { error } = await db.rpc("confirm_payment_intent", {
    p_intent_id: intent.id,
    p_method: method,
    p_provider_order_id: providerOrderId,
    p_paid_amount_cents: paidCents,
  });
  if (error) {
    console.error("[pagamento] confirmação falhou", intent.id, error.message);
    return false;
  }
  // Pedido antecipado muda o cardápio/fila; a conta muda o painel (Realtime avisa a equipe).
  try {
    updateTag(menuTag(intent.organizations.slug));
  } catch {}
  return true;
}

/** Consulta o Pagar.me e confirma se já foi pago. Usado pela página (verificação) e pelo webhook. */
export async function syncIntent(intentOrToken: { token: string } | { providerOrderId: string }): Promise<string> {
  const provider = paymentProvider();
  const db = createAdminClient();
  if (!provider || !db) return "unavailable";

  const query = db
    .from("payment_intents")
    .select("id, organization_id, kind, amount_cents, status, method, provider_order_id, pix_expires_at, expires_at, organizations (name, slug)");
  const { data } = await ("token" in intentOrToken ? query.eq("public_token", intentOrToken.token) : query.eq("provider_order_id", intentOrToken.providerOrderId)).maybeSingle();
  const intent = data as unknown as IntentRow | null;
  if (!intent) return "not_found";
  if (intent.status !== "pending" || !intent.provider_order_id) return intent.status;

  try {
    const order = await provider.getOrder(intent.provider_order_id);
    if (order.status === "paid") return (await confirm(intent, order.id, intent.method ?? "pix", order.paidAmountCents)) ? "paid" : "pending";
    if (order.status === "failed" || order.status === "canceled") {
      await db.from("payment_intents").update({ status: "failed", failure_reason: order.failureReason ?? "Pagamento não concluído" }).eq("id", intent.id).eq("status", "pending");
      return "failed";
    }
  } catch (e) {
    providerError(e);
  }
  return "pending";
}

/** Simulador: marca o Pix como pago (somente quando o simulador está ligado). */
export async function simulatePixPaid(token: string) {
  if (!simulatorEnabled()) return false;
  const intent = await loadIntent(token);
  if (!intent?.provider_order_id) return false;
  markSimulatedPaid(intent.provider_order_id);
  return (await syncIntent({ token })) === "paid";
}

export { simulatorEnabled };
