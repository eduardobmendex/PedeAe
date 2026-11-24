"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { friendlyDbError, getOrgContext, requirePlatformAdmin } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { menuTag } from "@/lib/menu";
import { pagarmeErrorMessage, RECIPIENT_ID_RE } from "@/lib/payments/pagarme";
import { recipientFormSchema } from "@/lib/payments/recipient-form";
import { isNoPendingKyc, recipientsApi, type KycLink, type RecipientInfo } from "@/lib/payments/recipients";
import { createClient } from "@/lib/supabase/server";

// Recebedores e KYC: exclusivo do Admin Geral (o banco confere de novo em cada RPC).

const NO_API = "O servidor não tem a chave do Pagar.me (PAGARME_SECRET_KEY).";

async function platformOrg(slug: string) {
  await requirePlatformAdmin();
  const ctx = await getOrgContext(slug);
  if (!ctx.isPlatformAdmin) throw new Error("forbidden");
  return ctx.organization;
}

function refresh(slug: string) {
  revalidatePath("/painel/recebedores");
  revalidatePath(`/painel/recebedores/${slug}`);
  revalidatePath(`/painel/${slug}/assinatura`);
}

/** Grava o que o Pagar.me respondeu; se mudou, o cardápio público precisa saber (pagamento online liga/desliga). */
async function saveInfo(orgId: string, slug: string, info: RecipientInfo) {
  const supabase = await createClient();
  const { data: changed, error } = await supabase.rpc("platform_sync_recipient", {
    p_org_id: orgId,
    p_recipient_id: info.id,
    p_status: info.status,
    p_kyc_status: info.kycStatus,
    p_kyc_reason: info.kycReason,
    p_type: info.type,
    p_name: info.name,
  });
  if (error) throw new Error(friendlyDbError(error.message));
  if (changed) updateTag(menuTag(slug));
  return changed as boolean;
}

export type SyncResult = { organizationId: string; ok: boolean; changed?: boolean; error?: string };

/** Consulta no Pagar.me todos os recebedores vinculados (a tela chama ao abrir). */
export async function syncAllRecipients(): Promise<{ results: SyncResult[]; error?: string }> {
  await requirePlatformAdmin();
  const api = recipientsApi();
  if (!api) return { results: [], error: NO_API };

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("organization_payment_settings")
    .select("organization_id, pagarme_recipient_id, organizations (slug)")
    .not("pagarme_recipient_id", "is", null);
  const list = (rows ?? []) as unknown as { organization_id: string; pagarme_recipient_id: string; organizations: { slug: string } }[];

  const results: SyncResult[] = [];
  // Poucas consultas por vez para não estourar o limite de requisições do Pagar.me.
  for (let i = 0; i < list.length; i += 5) {
    const batch = await Promise.all(
      list.slice(i, i + 5).map(async (r): Promise<SyncResult> => {
        try {
          const info = await api.get(r.pagarme_recipient_id);
          const changed = await saveInfo(r.organization_id, r.organizations.slug, info);
          return { organizationId: r.organization_id, ok: true, changed };
        } catch (e) {
          return { organizationId: r.organization_id, ok: false, error: pagarmeErrorMessage(e) };
        }
      }),
    );
    results.push(...batch);
  }
  if (results.some((r) => r.changed)) revalidatePath("/painel/recebedores");
  return { results };
}

/** Consulta um recebedor (botão "Atualizar status" e abertura da tela de detalhe). */
export async function syncRecipient(slug: string): Promise<{ ok: boolean; changed?: boolean; error?: string }> {
  const org = await platformOrg(slug);
  const api = recipientsApi();
  if (!api) return { ok: false, error: NO_API };
  const supabase = await createClient();
  const { data } = await supabase.from("organization_payment_settings").select("pagarme_recipient_id").eq("organization_id", org.id).maybeSingle();
  if (!data?.pagarme_recipient_id) return { ok: false, error: "Este estabelecimento ainda não tem recebedor." };
  try {
    const changed = await saveInfo(org.id, slug, await api.get(data.pagarme_recipient_id));
    if (changed) refresh(slug);
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, error: pagarmeErrorMessage(e) };
  }
}

/** "Iniciar KYC": cria o recebedor no Pagar.me com os dados do estabelecimento. */
export async function createRecipient(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const org = await platformOrg(slug);
  const api = recipientsApi();
  if (!api) return { error: NO_API };
  const parsed = recipientFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: current } = await supabase.from("organization_payment_settings").select("pagarme_recipient_id").eq("organization_id", org.id).maybeSingle();
  if (current?.pagarme_recipient_id) return { error: "Este estabelecimento já tem recebedor. Desvincule antes de cadastrar outro." };

  let info: RecipientInfo;
  try {
    info = await api.create(parsed.data, org.id);
  } catch (e) {
    console.error("[pagarme] criar recebedor:", pagarmeErrorMessage(e));
    return { error: `O Pagar.me recusou o cadastro: ${pagarmeErrorMessage(e)}` };
  }
  try {
    await saveInfo(org.id, slug, info);
  } catch (e) {
    // O recebedor existe no Pagar.me: mostra o ID para vincular à mão.
    return { error: `Recebedor ${info.id} criado no Pagar.me, mas não foi salvo aqui (${(e as Error).message}). Use "Vincular recebedor existente" com esse ID.` };
  }
  refresh(slug);
  return { success: `Recebedor ${info.id} criado. Agora o Pagar.me analisa o cadastro; quando pedir documentos, compartilhe o link de KYC.` };
}

const linkSchema = z.object({
  recipient_id: z.string().trim().regex(RECIPIENT_ID_RE, "ID do recebedor começa com re_ (ou rp_)"),
});

/** Vincula um recebedor já cadastrado no painel do Pagar.me (confere que existe). */
export async function linkRecipient(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const org = await platformOrg(slug);
  const api = recipientsApi();
  if (!api) return { error: NO_API };
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const info = await api.get(parsed.data.recipient_id);
    await saveInfo(org.id, slug, info);
  } catch (e) {
    return { error: `Não foi possível vincular: ${pagarmeErrorMessage(e)}` };
  }
  refresh(slug);
  return { success: "Recebedor vinculado." };
}

/** Link de KYC (prova de vida) para o responsável do estabelecimento. Vale ~20 minutos. */
export async function createKycLink(slug: string): Promise<{ link?: KycLink; error?: string }> {
  const org = await platformOrg(slug);
  const api = recipientsApi();
  if (!api) return { error: NO_API };
  const supabase = await createClient();
  const { data } = await supabase.from("organization_payment_settings").select("pagarme_recipient_id").eq("organization_id", org.id).maybeSingle();
  if (!data?.pagarme_recipient_id) return { error: "Inicie o KYC primeiro (cadastre o recebedor)." };
  try {
    const link = await api.kycLink(data.pagarme_recipient_id);
    await supabase.rpc("platform_mark_kyc_link", { p_org_id: org.id });
    refresh(slug);
    return { link };
  } catch (e) {
    if (isNoPendingKyc(e))
      return {
        error:
          "O Pagar.me ainda não pediu documentos para este recebedor (ou já os recebeu). O link só fica disponível quando o KYC está \"Aguardando documentos\". Atualize o status e tente de novo mais tarde.",
      };
    return { error: pagarmeErrorMessage(e) };
  }
}

const settingsSchema = z.object({
  enabled: z.literal("on").optional(),
  platform_fee_percent: z.coerce.number().int("Comissão em número inteiro").min(0, "Comissão entre 0% e 20%").max(20, "Comissão entre 0% e 20%"),
});

/** Liga/desliga o pagamento online e define a comissão da PedeAe. */
export async function savePaymentSettings(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const org = await platformOrg(slug);
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("organization_payment_settings")
    .select("pagarme_recipient_id, recipient_status")
    .eq("organization_id", org.id)
    .maybeSingle();
  const enabled = parsed.data.enabled === "on";
  if (enabled && !current?.pagarme_recipient_id) return { error: "Para ligar, o estabelecimento precisa de um recebedor (inicie o KYC)." };

  const { error } = await supabase.rpc("platform_set_payment_settings", {
    p_org_id: org.id,
    p_enabled: enabled,
    p_recipient_id: current?.pagarme_recipient_id ?? "",
    p_platform_fee_percent: parsed.data.platform_fee_percent,
  });
  if (error) return { error: friendlyDbError(error.message) };
  updateTag(menuTag(slug));
  refresh(slug);
  if (enabled && current?.recipient_status !== "active")
    return { success: "Salvo. O pagamento online começa a funcionar sozinho quando o KYC for aprovado." };
  return { success: enabled ? "Pagamento online ligado." : "Pagamento online desligado." };
}

/** Remove o vínculo com o recebedor (não apaga nada no Pagar.me) e desliga o pagamento online. */
export async function unlinkRecipient(slug: string): Promise<FormState> {
  const org = await platformOrg(slug);
  const supabase = await createClient();
  const { data: current } = await supabase.from("organization_payment_settings").select("platform_fee_percent").eq("organization_id", org.id).maybeSingle();
  const { error } = await supabase.rpc("platform_set_payment_settings", {
    p_org_id: org.id,
    p_enabled: false,
    p_recipient_id: "",
    p_platform_fee_percent: current?.platform_fee_percent ?? 0,
  });
  if (error) return { error: friendlyDbError(error.message) };
  updateTag(menuTag(slug));
  refresh(slug);
  return { success: "Recebedor desvinculado. O pagamento online foi desligado." };
}
