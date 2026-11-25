import { SUPABASE_URL } from "./supabase/env";

export const MENU_BUCKET = "menu-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Fotos padrão do catálogo base enviadas pelo Admin Geral. No banco: "catalog-images/<chave>/<arquivo>". */
export const CATALOG_BUCKET = "catalog-images";

/**
 * Foto do catálogo base (arquivo do app, link externo ou foto enviada pelo Admin Geral),
 * compartilhada entre estabelecimentos: o estabelecimento nunca apaga do Storage.
 */
export const isCatalogImage = (path: string | null | undefined) =>
  !!path && (path.startsWith("/catalog/") || path.startsWith("https://") || path.startsWith(`${CATALOG_BUCKET}/`));

/** URL pública de uma imagem: catálogo base (arquivo, link ou bucket do catálogo) ou bucket do cardápio. */
export function imageUrl(path: string | null | undefined) {
  if (path?.startsWith(`${CATALOG_BUCKET}/`)) return `${SUPABASE_URL}/storage/v1/object/public/${path}`;
  if (isCatalogImage(path)) return path as string;
  return path ? `${SUPABASE_URL}/storage/v1/object/public/${MENU_BUCKET}/${path}` : null;
}
