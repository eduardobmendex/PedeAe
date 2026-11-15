"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { menuTag } from "@/lib/menu";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f-]{36}$/;

/** Marca o chamado da mesa como atendido. */
export async function resolveServiceCall(slug: string, callId: string): Promise<{ ok: boolean }> {
  await requirePermission(slug, "view_orders");
  if (!UUID.test(callId)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_service_call", { p_call_id: callId });
  return { ok: !error };
}

/** Esgotado com um toque (qualquer pessoa da equipe que vê pedidos). */
export async function setSoldOut(slug: string, productId: string, soldOut: boolean): Promise<{ ok: boolean }> {
  await requirePermission(slug, "view_orders");
  if (!UUID.test(productId)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_sold_out", { p_product_id: productId, p_sold_out: soldOut });
  if (error) return { ok: false };
  // O cardápio público é cacheado: invalida para o cliente ver na hora.
  updateTag(menuTag(slug));
  revalidatePath(`/painel/${slug}/cozinha`);
  revalidatePath(`/painel/${slug}/cardapio`);
  return { ok: true };
}
