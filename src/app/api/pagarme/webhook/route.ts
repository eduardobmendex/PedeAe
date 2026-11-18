import { timingSafeEqual } from "node:crypto";
import { syncIntent } from "@/lib/payments/service";

/**
 * Webhook do Pagar.me (configure no painel: eventos order.paid, order.payment_failed,
 * charge.paid, charge.payment_failed) com a URL:
 *   https://<seu-domínio>/api/pagarme/webhook?token=<PAGARME_WEBHOOK_SECRET>
 *
 * O corpo NÃO é usado como prova de pagamento: só indica qual pedido mudou. A confirmação
 * consulta o pedido direto na API do Pagar.me com a chave secreta.
 */
export async function POST(request: Request) {
  const secret = process.env.PAGARME_WEBHOOK_SECRET;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!secret || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { type?: string; data?: { id?: string; order?: { id?: string } } } | null;
  const type = body?.type ?? "";
  const orderId = type.startsWith("charge.") ? body?.data?.order?.id : body?.data?.id;
  if (!orderId || !/^or_[A-Za-z0-9]+$/.test(orderId)) return Response.json({ ignored: true });

  const status = await syncIntent({ providerOrderId: orderId });
  // 200 mesmo quando não é nosso (evita reenvios infinitos); 503 faz o Pagar.me tentar de novo.
  if (status === "unavailable") return new Response("payments not configured", { status: 503 });
  return Response.json({ status });
}
