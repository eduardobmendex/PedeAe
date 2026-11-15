"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, requirePermission } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { parseBRL } from "@/lib/money";
import { couponCodeSchema } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";

const optionalDate = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Data inválida")
  .transform((v) => v || null);
const optionalMoney = z.string().transform((v, ctx) => {
  if (!v.trim()) return 0;
  const c = parseBRL(v);
  if (c === null) {
    ctx.addIssue({ code: "custom", message: "Valor mínimo inválido" });
    return z.NEVER;
  }
  return c;
});

const couponSchema = z
  .object({
    code: couponCodeSchema,
    description: z.string().trim().max(120),
    kind: z.enum(["percent", "fixed"]),
    value: z.string().trim(),
    min_order: optionalMoney,
    max_uses: z
      .string()
      .trim()
      .transform((v) => (v ? Number(v) : null))
      .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Limite de usos deve ser um número inteiro"),
    valid_from: optionalDate,
    valid_until: optionalDate,
  })
  .transform((c, ctx) => {
    const value = c.kind === "percent" ? Number(c.value.replace(",", ".")) : parseBRL(c.value);
    if (value === null || !Number.isFinite(value) || value <= 0 || (c.kind === "percent" && (value > 100 || !Number.isInteger(value)))) {
      ctx.addIssue({ code: "custom", message: c.kind === "percent" ? "Percentual deve ser inteiro entre 1 e 100" : "Valor do desconto inválido" });
      return z.NEVER;
    }
    if (c.valid_from && c.valid_until && c.valid_until < c.valid_from) {
      ctx.addIssue({ code: "custom", message: "A validade termina antes de começar" });
      return z.NEVER;
    }
    return { ...c, value };
  });

export async function createCoupon(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { organization } = await requirePermission(slug, "manage_coupons");
  const parsed = couponSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const c = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("coupons").insert({
    organization_id: organization.id,
    code: c.code,
    description: c.description || null,
    kind: c.kind,
    value: c.value,
    min_order_cents: c.min_order,
    max_uses: c.max_uses,
    valid_from: c.valid_from,
    valid_until: c.valid_until,
  });
  if (error) {
    if (error.code === "23505") return { error: "Já existe um cupom com esse código." };
    return { error: friendlyDbError(error.message) };
  }
  revalidatePath(`/painel/${slug}/cupons`);
  return { success: `Cupom ${c.code} criado.` };
}

export async function setCouponActive(slug: string, couponId: string, active: boolean) {
  const { organization } = await requirePermission(slug, "manage_coupons");
  if (!/^[0-9a-f-]{36}$/.test(couponId)) return;
  const supabase = await createClient();
  await supabase.from("coupons").update({ active }).eq("id", couponId).eq("organization_id", organization.id);
  revalidatePath(`/painel/${slug}/cupons`);
}

export async function deleteCoupon(slug: string, couponId: string) {
  const { organization } = await requirePermission(slug, "manage_coupons");
  if (!/^[0-9a-f-]{36}$/.test(couponId)) return;
  const supabase = await createClient();
  // Pedidos antigos guardam o código do cupom, então o histórico continua legível.
  await supabase.from("coupons").delete().eq("id", couponId).eq("organization_id", organization.id);
  revalidatePath(`/painel/${slug}/cupons`);
}
