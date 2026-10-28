"use server";

import { orderErrorMessage, orderPayloadSchema, type PlaceOrderResult } from "@/lib/orders";
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
  });
  if (error) return { ok: false, ...orderErrorMessage(error.message) };

  const result = data as { public_token: string; order_number: number };
  return { ok: true, publicToken: result.public_token, orderNumber: result.order_number };
}
