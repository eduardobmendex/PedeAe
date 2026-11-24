"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, getOrgContext } from "@/lib/auth";
import { paymentMethods, planIds } from "@/lib/billing";
import type { FormState } from "@/lib/form-state";
import { parseBRL } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

/** Só o Admin Geral mexe na cobrança (o banco também confere). */
async function platformOrg(slug: string) {
  const ctx = await getOrgContext(slug);
  if (!ctx.isPlatformAdmin) throw new Error("forbidden");
  return ctx.organization;
}

function refresh(slug: string) {
  revalidatePath(`/painel/${slug}/assinatura`);
  revalidatePath("/painel");
}

const money = z.string().transform((v, ctx) => {
  const cents = parseBRL(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Valor inválido" });
    return z.NEVER;
  }
  return cents;
});
const optionalDate = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Data inválida")
  .transform((v) => v || null);

const billingSchema = z.object({
  plan: z.enum(planIds as [string, ...string[]]),
  monthly_price: money,
  due_day: z.coerce.number().int().min(1, "Dia entre 1 e 28").max(28, "Dia entre 1 e 28"),
  trial_ends_at: optionalDate,
  notes: z.string().trim().max(500),
});

export async function saveBilling(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const organization = await platformOrg(slug);
  const parsed = billingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const b = parsed.data;
  if (b.plan === "trial" && !b.trial_ends_at) return { error: "Informe até quando vai o teste." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_billing", {
    p_org_id: organization.id,
    p_plan: b.plan,
    p_monthly_price_cents: b.monthly_price,
    p_due_day: b.due_day,
    p_trial_ends_at: b.trial_ends_at,
    p_notes: b.notes,
  });
  if (error) return { error: friendlyDbError(error.message) };
  refresh(slug);
  return { success: "Assinatura salva." };
}

const paymentSchema = z.object({
  reference_month: z.string().regex(/^\d{4}-\d{2}$/, "Escolha o mês de referência"),
  amount: money.refine((c) => c > 0, "Valor deve ser maior que zero"),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do pagamento"),
  method: z.enum(Object.keys(paymentMethods) as [string, ...string[]]),
  notes: z.string().trim().max(280),
});

export async function recordPayment(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const organization = await platformOrg(slug);
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_record_payment", {
    p_org_id: organization.id,
    p_reference_month: `${p.reference_month}-01`,
    p_amount_cents: p.amount,
    p_paid_at: p.paid_at,
    p_method: p.method,
    p_notes: p.notes,
  });
  if (error) {
    if (error.message.includes("payment_exists")) return { error: "Já existe um pagamento para esse mês." };
    return { error: friendlyDbError(error.message) };
  }
  refresh(slug);
  return { success: "Pagamento registrado." };
}

export async function deletePayment(slug: string, paymentId: string) {
  await platformOrg(slug);
  if (!/^[0-9a-f-]{36}$/.test(paymentId)) return;
  const supabase = await createClient();
  await supabase.rpc("platform_delete_payment", { p_payment_id: paymentId });
  refresh(slug);
}
