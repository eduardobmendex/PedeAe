"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { friendlyDbError, requirePlatformAdmin } from "@/lib/auth";
import { menuTag } from "@/lib/menu";
import { CATALOG_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

// Catálogo base: foto padrão de cada item. Exclusivo do Admin Geral (o banco confere de novo na RPC).

const keySchema = z.string().regex(/^[a-z0-9-]+$/);
const fileRe = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export type CatalogImageResult = { ok: true; products: number; organizations: number } | { ok: false; error: string };

/**
 * Define (objectName = "<chave>/<uuid>.<ext>", já enviado ao bucket pelo navegador) ou remove
 * (null) a foto personalizada do item. Com `propagate`, troca também nos cardápios que já
 * importaram o item e ainda usam a foto do catálogo.
 */
export async function setCatalogImage(key: string, objectName: string | null, propagate: boolean): Promise<CatalogImageResult> {
  await requirePlatformAdmin();
  if (!keySchema.safeParse(key).success) return { ok: false, error: "Item inválido." };
  if (objectName !== null) {
    const [folder, file, ...rest] = objectName.split("/");
    if (folder !== key || !file || rest.length || !fileRe.test(file)) return { ok: false, error: "Imagem inválida." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_set_catalog_image", {
    p_key: key,
    p_path: objectName ? `${CATALOG_BUCKET}/${objectName}` : null,
    p_propagate: propagate,
  });
  if (error) {
    if (objectName) await supabase.storage.from(CATALOG_BUCKET).remove([objectName]);
    if (error.message.includes("not_found")) return { ok: false, error: "Item não encontrado no catálogo." };
    return { ok: false, error: friendlyDbError(error.message) };
  }

  const result = data as { previous: string | null; products: number; slugs: string[] };
  // A foto anterior só sai do Storage quando nenhum cardápio pode estar usando: com a troca
  // propagada, todo produto que usava a foto do catálogo já recebeu a nova.
  if (result.previous && propagate) {
    await supabase.storage.from(CATALOG_BUCKET).remove([result.previous.slice(CATALOG_BUCKET.length + 1)]);
  }
  for (const slug of result.slugs) {
    updateTag(menuTag(slug));
    revalidatePath(`/painel/${slug}/cardapio`, "layout");
  }
  revalidatePath("/painel/catalogo");
  return { ok: true, products: result.products, organizations: result.slugs.length };
}
