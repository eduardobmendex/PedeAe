"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { friendlyDbError, requireOrgRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { permissions, type Permission } from "@/lib/permissions";
import { invitationSchema, updateMembershipSchema } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

const permissionsFormSchema = z.array(z.enum(permissions));

// As checagens de papel aqui melhoram a mensagem de erro; a autorização
// definitiva é feita pelas RPCs no banco.

export async function createInvitation(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { organization } = await requireOrgRole(slug, ["admin"]);
  const parsed = invitationSchema.safeParse({ ...Object.fromEntries(formData), organizationId: organization.id });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_invitation", {
    p_org_id: organization.id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) return { error: friendlyDbError(error.message) };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  revalidatePath(`/painel/${slug}/equipe`);
  return {
    success: `Convite criado para ${parsed.data.email}. Envie o link abaixo (válido por 7 dias):`,
    data: { link: `${origin}/convite/${token}` },
  };
}

export async function revokeInvitation(slug: string, invitationId: string) {
  await requireOrgRole(slug, ["admin"]);
  const supabase = await createClient();
  await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId });
  revalidatePath(`/painel/${slug}/equipe`);
}

export async function updateMembership(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireOrgRole(slug, ["admin"]);
  const parsed = updateMembershipSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_membership", {
    p_membership_id: parsed.data.membershipId,
    p_role: parsed.data.role,
    p_status: parsed.data.status,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath(`/painel/${slug}/equipe`);
  return { success: "Salvo." };
}

export async function setPermissions(
  slug: string,
  membershipId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireOrgRole(slug, ["admin"]);
  const parsed = permissionsFormSchema.safeParse(formData.getAll("granted"));
  if (!parsed.success) return { error: "Permissões inválidas." };

  // Todas as permissões configuráveis exibidas viram true/false explícito.
  const shown = formData.getAll("shown").map(String);
  const payload = Object.fromEntries(shown.map((p) => [p, parsed.data.includes(p as Permission)]));

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_membership_permissions", {
    p_membership_id: membershipId,
    p_permissions: payload,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath(`/painel/${slug}/equipe`);
  return { success: "Permissões salvas." };
}
