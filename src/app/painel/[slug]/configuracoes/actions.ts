"use server";

import { revalidatePath, updateTag } from "next/cache";
import { menuTag } from "@/lib/menu";
import { MENU_BUCKET } from "@/lib/storage";
import { friendlyDbError, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isThemeId } from "@/lib/themes";
import { brandingSchema } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

export async function saveBranding(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { organization } = await requirePermission(slug, "manage_brand");
  const parsed = brandingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, custom_colors, brand_color, accent_color, font, corners, logo_path, cover_path } = parsed.data;
  for (const path of [logo_path, cover_path]) {
    if (path && !path.startsWith(`${organization.id}/`)) return { error: "Imagem inválida." };
  }

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("organization_settings")
    .select("settings, logo_path, cover_path")
    .eq("organization_id", organization.id)
    .single();
  if (readError) return { error: friendlyDbError(readError.message) };

  // RLS só permite o update para admins; .select() confirma que a linha foi alterada.
  const { data: updated, error } = await supabase
    .from("organization_settings")
    .update({
      brand_color: brand_color.toUpperCase(),
      accent_color: accent_color.toUpperCase(),
      logo_path,
      cover_path,
      settings: { ...(current.settings as Record<string, unknown>), font, corners, custom_colors },
    })
    .eq("organization_id", organization.id)
    .select("organization_id");
  if (error || !updated?.length) return { error: friendlyDbError(error?.message ?? "forbidden") };

  if (name !== organization.name) {
    const { error: nameError } = await supabase.from("organizations").update({ name }).eq("id", organization.id);
    if (nameError) return { error: friendlyDbError(nameError.message) };
  }

  // Remove do Storage as imagens substituídas.
  const replaced = [current.logo_path, current.cover_path].filter(
    (p): p is string => !!p && p !== logo_path && p !== cover_path,
  );
  if (replaced.length) await supabase.storage.from(MENU_BUCKET).remove(replaced);

  updateTag(menuTag(slug));
  revalidatePath(`/painel/${slug}`, "layout");
  return { success: "Alterações publicadas." };
}

export async function saveServiceSettings(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { organization } = await requirePermission(slug, "manage_brand");
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("organization_settings")
    .select("settings")
    .eq("organization_id", organization.id)
    .single();
  if (readError) return { error: friendlyDbError(readError.message) };

  const { data: updated, error } = await supabase
    .from("organization_settings")
    .update({
      settings: {
        ...(current.settings as Record<string, unknown>),
        require_order_confirmation: formData.get("require_order_confirmation") === "on",
      },
    })
    .eq("organization_id", organization.id)
    .select("organization_id");
  if (error || !updated?.length) return { error: friendlyDbError(error?.message ?? "forbidden") };

  revalidatePath(`/painel/${slug}/configuracoes`);
  return { success: "Regras de atendimento salvas." };
}

/** Salva a identidade visual. O banco valida a permissão (supervisor ou acima). */
export async function saveIdentity(slug: string, theme: unknown): Promise<FormState> {
  const { organization } = await requirePermission(slug, "manage_theme");
  if (!isThemeId(theme)) return { error: "Identidade inválida." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_organization_theme", { p_org_id: organization.id, p_theme: theme });
  if (error) return { error: friendlyDbError(error.message) };

  updateTag(menuTag(slug));
  revalidatePath(`/painel/${slug}`, "layout");
  return undefined;
}
