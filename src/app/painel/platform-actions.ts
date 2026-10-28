"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { friendlyDbError, requireOrgRole, requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createOrganizationSchema, memberRoles } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

// Ações exclusivas do administrador da plataforma. O banco revalida
// (private.is_platform_admin) em cada RPC.

export async function platformCreateOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePlatformAdmin();
  const parsed = createOrganizationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_create_organization", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) return { error: friendlyDbError(error.message) };

  // Próximo passo natural: cadastrar o responsável pelo estabelecimento.
  redirect(`/painel/${parsed.data.slug}/equipe`);
}

const statusSchema = z.enum(["active", "suspended", "cancelled"]);

export async function setOrganizationStatus(organizationId: string, status: string) {
  await requirePlatformAdmin();
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase.rpc("platform_set_organization_status", { p_org_id: organizationId, p_status: parsed.data });
  revalidatePath("/painel");
}

const memberSchema = z.object({
  name: z.string().trim().max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  password: z.string().max(72),
  role: z.enum(memberRoles),
});

export async function platformCreateMember(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requirePlatformAdmin();
  const { organization } = await requireOrgRole(slug, ["admin"]);
  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_create_member", {
    p_org_id: organization.id,
    p_email: parsed.data.email,
    p_name: parsed.data.name,
    p_password: parsed.data.password,
    p_role: parsed.data.role,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath(`/painel/${slug}/equipe`);
  const created = (data as { created: boolean }).created;
  return {
    success: created
      ? `Conta criada para ${parsed.data.email}. A pessoa já pode entrar com a senha definida.`
      : `${parsed.data.email} já tinha conta: foi vinculado(a) ao estabelecimento com a senha que já usa.`,
  };
}
