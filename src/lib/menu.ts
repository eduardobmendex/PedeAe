import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

export type PublicOptionItem = { id: string; name: string; price_delta_cents: number };
export type PublicOption = { id: string; name: string; min_select: number; max_select: number; items: PublicOptionItem[] };
export type PublicProduct = {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  image_path: string | null;
  featured: boolean;
  options: PublicOption[];
};
export type PublicCategory = { id: string; name: string; products: PublicProduct[] };
export type PublicMenu = {
  organization: { id: string; name: string; slug: string };
  branding: {
    theme: string;
    brand_color: string;
    accent_color: string;
    logo_path: string | null;
    cover_path: string | null;
    settings: Record<string, unknown> | null;
  };
  categories: PublicCategory[];
};

export const menuTag = (slug: string) => `menu:${slug}`;

/** Cardápio publicado. Cacheado e invalidado por updateTag(menuTag(slug)) nas edições. */
export async function getPublicMenu(slug: string): Promise<PublicMenu | null> {
  "use cache";
  cacheTag(menuTag(slug));
  cacheLife("hours");

  const { data, error } = await createPublicClient().rpc("get_public_menu", { p_slug: slug });
  if (error) throw new Error(`get_public_menu: ${error.message}`);
  return (data as PublicMenu | null) ?? null;
}

/** Mesa do QR Code. Nunca cacheado: revogação precisa valer na hora. */
export async function resolveTableToken(token: string) {
  if (!/^[0-9a-f]{24}$/.test(token)) return null;
  const { data } = await createPublicClient().rpc("resolve_table_token", { p_token: token });
  return (data as { slug: string; table_id: string; table_name: string } | null) ?? null;
}
