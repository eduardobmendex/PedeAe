import { timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { menuTag } from "@/lib/menu";
import { pagarmeErrorMessage, RECIPIENT_ID_RE } from "@/lib/payments/pagarme";
import { recipientsApi } from "@/lib/payments/recipients";
import { syncIntent } from "@/lib/payments/service";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook do Pagar.me. Configure no painel, com a URL
 *   https://<seu-domínio>/api/pagarme/webhook?token=<PAGARME_WEBHOOK_SECRET>
 * os eventos: order.paid, order.payment_failed, charge.paid, charge.payment_failed e recipient.updated.
 *
 * O corpo NÃO é usado como prova de nada: só indica o que mudou. O pedido (ou o recebedor)
 * é sempre consultado direto na API do Pagar.me com a chave secreta.
 */
export async function POST(request: Request) {
  const secret = process.env.PAGARME_WEBHOOK_SECRET;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!secret || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { type?: string; data?: { id?: string; order?: { id?: string } } } | null;
  const type = body?.type ?? "";

  if (type.startsWith("recipient.")) return recipientChanged(body?.data?.id);

  const orderId = type.startsWith("charge.") ? body?.data?.order?.id : body?.data?.id;
  if (!orderId || !/^or_[A-Za-z0-9]+$/.test(orderId)) return Response.json({ ignored: true });

  const status = await syncIntent({ providerOrderId: orderId });
  // 200 mesmo quando não é nosso (evita reenvios infinitos); 503 faz o Pagar.me tentar de novo.
  if (status === "unavailable") return new Response("payments not configured", { status: 503 });
  return Response.json({ status });
}

/** recipient.updated: KYC/credenciamento mudou. Consulta o recebedor e grava o status. */
async function recipientChanged(id: string | undefined) {
  if (!id || !RECIPIENT_ID_RE.test(id)) return Response.json({ ignored: true });
  const api = recipientsApi();
  const db = createAdminClient();
  if (!api || !db) return new Response("payments not configured", { status: 503 });

  let info;
  try {
    info = await api.get(id);
  } catch (e) {
    console.error("[pagarme] webhook recebedor:", pagarmeErrorMessage(e));
    return new Response("recipient lookup failed", { status: 502 });
  }
  const { data: slug, error } = await db.rpc("service_sync_recipient", {
    p_recipient_id: info.id,
    p_status: info.status,
    p_kyc_status: info.kycStatus,
    p_kyc_reason: info.kycReason,
  });
  if (error) {
    console.error("[pagarme] webhook recebedor (banco):", error.message);
    return new Response("db error", { status: 500 });
  }
  if (slug) {
    // Recebedor aprovado (ou bloqueado) liga/desliga o pagamento online no cardápio.
    revalidateTag(menuTag(slug as string), { expire: 0 });
    revalidatePath("/painel/recebedores");
  }
  return Response.json({ recipient: info.id, status: info.status, changed: !!slug });
}
