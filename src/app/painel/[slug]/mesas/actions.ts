"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";

function refresh(slug: string) {
  revalidatePath(`/painel/${slug}/mesas`);
  revalidatePath(`/painel/${slug}/qrcodes`);
}

const bulkSchema = z
  .object({
    prefix: z.string().trim().max(30),
    from: z.coerce.number().int().min(0).max(9999),
    to: z.coerce.number().int().min(0).max(9999),
  })
  .refine((v) => v.to >= v.from, { message: "O número final precisa ser maior ou igual ao inicial" })
  .refine((v) => v.to - v.from < 200, { message: "Crie no máximo 200 mesas por vez" });

export async function createTables(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { organization } = await requirePermission(slug, "manage_tables");
  const parsed = bulkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { prefix, from, to } = parsed.data;
  const supabase = await createClient();
  const { data: existing } = await supabase.from("tables").select("name").eq("organization_id", organization.id);
  const taken = new Set((existing ?? []).map((t) => t.name.toLowerCase()));

  const rows = [];
  for (let n = from; n <= to; n++) {
    const name = `${prefix} ${String(n).padStart(2, "0")}`.trim();
    if (!taken.has(name.toLowerCase())) rows.push({ organization_id: organization.id, name, sort_order: n });
  }
  if (rows.length === 0) return { error: "Essas mesas já existem." };

  const { error } = await supabase.from("tables").insert(rows);
  if (error) return { error: friendlyDbError(error.message) };

  refresh(slug);
  const skipped = to - from + 1 - rows.length;
  return { success: `${rows.length} mesa(s) criada(s)${skipped ? `, ${skipped} já existia(m)` : ""}.` };
}

export async function renameTable(slug: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission(slug, "manage_tables");
  const name = z.string().trim().min(1).max(40).safeParse(formData.get("name"));
  if (!name.success) return { error: "Nome inválido." };

  const supabase = await createClient();
  const { error } = await supabase.from("tables").update({ name: name.data }).eq("id", id);
  if (error) {
    return { error: error.message.includes("duplicate") ? "Já existe uma mesa com esse nome." : friendlyDbError(error.message) };
  }
  refresh(slug);
  return { success: "Salvo." };
}

export async function setTableActive(slug: string, id: string, active: boolean) {
  await requirePermission(slug, "manage_tables");
  const supabase = await createClient();
  await supabase.from("tables").update({ active }).eq("id", id);
  refresh(slug);
}

export async function rotateTableQr(slug: string, id: string) {
  await requirePermission(slug, "manage_tables");
  const supabase = await createClient();
  await supabase.rpc("rotate_table_qr", { p_table_id: id });
  refresh(slug);
}

export async function deleteTable(slug: string, id: string) {
  await requirePermission(slug, "manage_tables");
  const supabase = await createClient();
  await supabase.from("tables").delete().eq("id", id);
  refresh(slug);
}
