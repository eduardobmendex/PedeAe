import { SUPABASE_URL } from "./supabase/env";

export const MENU_BUCKET = "menu-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** URL pública de uma imagem do bucket do cardápio. */
export function imageUrl(path: string | null | undefined) {
  return path ? `${SUPABASE_URL}/storage/v1/object/public/${MENU_BUCKET}/${path}` : null;
}
