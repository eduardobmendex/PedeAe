"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { orderErrorMessage, orderPayloadSchema, orderStatuses, type PlaceOrderResult } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";

export async function updateOrderStatus(slug: string, orderId: string, to: string): Promise<FormState> {
  await requirePermission(slug, "view_orders");
  if (!(orderStatuses as readonly string[]).includes(to)) return { error: "Status inválido." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_order_status", { p_order_id: orderId, p_to: to });
  if (error) return orderErrorMessage(error.message);

  revalidatePath(`/painel/${slug}/pedidos`);
  revalidatePath(`/painel/${slug}/cozinha`);
  revalidatePath(`/painel/${slug}`);
  return undefined;
}

export async function createManualOrder(slug: string, tableId: string | null, payload: unknown): Promise<PlaceOrderResult> {
  const { organization } = await requirePermission(slug, "create_manual_order");
  const parsed = orderPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (tableId !== null && !/^[0-9a-f-]{36}$/.test(tableId)) return { ok: false, error: "Mesa inválida." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manual_order", {
    p_org_id: organization.id,
    p_table_id: tableId,
    p_items: parsed.data.items,
    p_customer_name: parsed.data.customerName,
    p_notes: parsed.data.notes,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return { ok: false, ...orderErrorMessage(error.message) };

  revalidatePath(`/painel/${slug}/pedidos`);
  const result = data as { public_token: string; order_number: number };
  return { ok: true, publicToken: result.public_token, orderNumber: result.order_number };
}
