import { SUPABASE_URL } from "./supabase/env";

export const MENU_BUCKET = "menu-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Foto do catálogo base (arquivo do app ou link externo), compartilhada: nunca é apagada do Storage. */
export const isCatalogImage = (path: string | null | undefined) =>
  !!path && (path.startsWith("/catalog/") || path.startsWith("https://"));

/** URL pública de uma imagem: catálogo base (arquivo ou link) ou bucket do cardápio. */
export function imageUrl(path: string | null | undefined) {
  if (isCatalogImage(path)) return path as string;
  return path ? `${SUPABASE_URL}/storage/v1/object/public/${MENU_BUCKET}/${path}` : null;
}
