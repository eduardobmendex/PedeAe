import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Permission } from "@/lib/permissions";
import type { MemberRole } from "@/lib/validation";

export type CurrentUser = { id: string; email: string };

export type OrgContext = {
  organization: { id: string; name: string; slug: string; status: string };
  /** id é null quando o acesso vem do admin da plataforma (sem vínculo). */
  membership: { id: string | null; role: MemberRole; permissions: Record<string, boolean> };
  isPlatformAdmin: boolean;
};

/** Usuário autenticado (JWT validado) ou null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: String(claims.email ?? "") };
});

export async function requireUser(next = "/painel"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Dono do SaaS: age como admin em todos os estabelecimentos (validado também no banco). */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  if (!(await getCurrentUser())) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("am_i_platform_admin");
  return data === true;
});

export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!(await isPlatformAdmin())) notFound();
  return user;
}

/**
 * Resolve o estabelecimento pelo slug e o vínculo ATIVO do usuário com ele.
 * Se o usuário não for membro, o RLS nem devolve a organização => 404.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser(`/painel/${slug}`);
  const supabase = await createClient();

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, slug, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!organization) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("id, role, permissions")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const platformAdmin = await isPlatformAdmin();
  if (platformAdmin) {
    return {
      organization,
      membership: { id: membership?.id ?? null, role: "admin", permissions: {} },
      isPlatformAdmin: true,
    };
  }
  if (!membership) notFound();

  return { organization, membership: membership as OrgContext["membership"], isPlatformAdmin: false };
});

/** Exige um dos papéis informados; usado em páginas e Server Actions. */
export async function requireOrgRole(slug: string, roles: MemberRole[]): Promise<OrgContext> {
  const ctx = await getOrgContext(slug);
  if (!roles.includes(ctx.membership.role)) notFound();
  return ctx;
}

/** Exige uma permissão da matriz. O banco revalida com private.can(). */
export async function requirePermission(slug: string, permission: Permission): Promise<OrgContext> {
  const ctx = await getOrgContext(slug);
  if (!can(ctx.membership, permission)) notFound();
  return ctx;
}

/** Converte erros conhecidos das RPCs em mensagens para o usuário. */
export function friendlyDbError(message: string | undefined): string {
  if (!message) return "Erro inesperado. Tente novamente.";
  if (message.includes("organizations_slug_key")) return "Esse endereço já está em uso. Escolha outro.";
  if (message.includes("forbidden") || message.includes("row-level security"))
    return "Você não tem permissão para esta ação.";
  if (message.includes("invitation_email_mismatch"))
    return "Este convite foi enviado para outro e-mail. Entre com a conta convidada.";
  if (message.includes("invitation_invalid")) return "Convite inválido, expirado ou já utilizado.";
  if (message.includes("cannot_change_own_membership")) return "Você não pode alterar o seu próprio acesso.";
  if (message.includes("check constraint")) return "Algum valor informado é inválido.";
  if (message.includes("weak_password")) return "A senha precisa ter pelo menos 8 caracteres.";
  if (message.includes("invalid_email")) return "E-mail inválido.";
  return "Não foi possível concluir a operação.";
}
