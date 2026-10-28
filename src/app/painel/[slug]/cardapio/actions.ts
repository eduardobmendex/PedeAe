"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { friendlyDbError, requirePermission } from "@/lib/auth";
import { menuTag } from "@/lib/menu";
import { parseBRL } from "@/lib/money";
import { MENU_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";

function refresh(slug: string) {
  updateTag(menuTag(slug));
  revalidatePath(`/painel/${slug}/cardapio`, "layout");
}

// ---------------------------------------------------------------- Categorias

const categoryName = z.string().trim().min(1, "Informe o nome").max(80);

export async function createCategory(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { organization } = await requirePermission(slug, "manage_menu");
  const name = categoryName.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("organization_id", organization.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("categories")
    .insert({ organization_id: organization.id, name: name.data, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error) return { error: friendlyDbError(error.message) };

  refresh(slug);
  return { success: "Categoria criada." };
}

export async function updateCategory(slug: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission(slug, "manage_menu");
  const name = categoryName.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: name.data, active: formData.get("active") === "on" })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  refresh(slug);
  return { success: "Salvo." };
}

export async function moveCategory(slug: string, id: string, direction: "up" | "down") {
  const { organization } = await requirePermission(slug, "manage_menu");
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, sort_order")
    .eq("organization_id", organization.id)
    .order("sort_order")
    .order("name");
  if (!categories) return;

  const index = categories.findIndex((c) => c.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= categories.length) return;

  // Renumera tudo para manter a ordem estável mesmo com valores repetidos.
  const ordered = [...categories];
  [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
  await Promise.all(
    ordered.map((c, i) => (c.sort_order === i + 1 ? null : supabase.from("categories").update({ sort_order: i + 1 }).eq("id", c.id))),
  );
  refresh(slug);
}

export async function deleteCategory(slug: string, id: string): Promise<FormState> {
  await requirePermission(slug, "manage_menu");
  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) {
    return {
      error: error.message.includes("foreign key")
        ? "Mova ou exclua os produtos desta categoria antes."
        : friendlyDbError(error.message),
    };
  }
  refresh(slug);
  return { success: "Categoria excluída." };
}

// ---------------------------------------------------------------- Produtos

const optionItemSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome de cada adicional").max(80),
  price_delta_cents: z.number().int().min(0).max(100_000_000),
  available: z.boolean(),
});

const optionGroupSchema = z
  .object({
    name: z.string().trim().min(1, "Informe o nome de cada grupo de adicionais").max(80),
    min_select: z.number().int().min(0),
    max_select: z.number().int().min(1),
    items: z.array(optionItemSchema).min(1, "Cada grupo precisa de pelo menos um item").max(50),
  })
  .refine((g) => g.min_select <= g.max_select, { message: "Mínimo não pode ser maior que o máximo" })
  .refine((g) => g.min_select <= g.items.length, { message: "Mínimo maior que a quantidade de itens do grupo" });

const productSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  description: z.string().trim().max(600),
  category_id: z.string().uuid("Escolha a categoria"),
  price: z.string(),
  available: z.boolean(),
  featured: z.boolean(),
  image_path: z.string().max(300).nullable(),
  options: z.array(optionGroupSchema).max(20),
});

export async function saveProduct(
  slug: string,
  productId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { organization } = await requirePermission(slug, "manage_menu");

  let options: unknown;
  try {
    options = JSON.parse(String(formData.get("options") ?? "[]"));
  } catch {
    return { error: "Adicionais inválidos." };
  }

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    category_id: formData.get("category_id"),
    price: formData.get("price"),
    available: formData.get("available") === "on",
    featured: formData.get("featured") === "on",
    image_path: (formData.get("image_path") as string) || null,
    options,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const price_cents = parseBRL(parsed.data.price);
  if (price_cents === null) return { error: "Preço inválido. Use o formato 12,50." };

  // A imagem precisa estar na pasta da própria organização.
  const imagePath = parsed.data.image_path;
  if (imagePath && !imagePath.startsWith(`${organization.id}/`)) return { error: "Imagem inválida." };

  const supabase = await createClient();
  const row = {
    name: parsed.data.name,
    description: parsed.data.description,
    category_id: parsed.data.category_id,
    price_cents,
    available: parsed.data.available,
    featured: parsed.data.featured,
    image_path: imagePath,
  };

  let id = productId;
  let previousImage: string | null = null;
  if (id) {
    const { data: current } = await supabase.from("products").select("image_path").eq("id", id).maybeSingle();
    if (!current) return { error: "Produto não encontrado." };
    previousImage = current.image_path;
    const { error } = await supabase.from("products").update(row).eq("id", id);
    if (error) return { error: friendlyDbError(error.message) };
  } else {
    const { data, error } = await supabase
      .from("products")
      .insert({ ...row, organization_id: organization.id })
      .select("id")
      .single();
    if (error) return { error: friendlyDbError(error.message) };
    id = data.id;
  }

  const { error: optionsError } = await supabase.rpc("save_product_options", {
    p_product_id: id,
    p_groups: parsed.data.options,
  });
  if (optionsError) return { error: `Produto salvo, mas os adicionais falharam: ${friendlyDbError(optionsError.message)}` };

  if (previousImage && previousImage !== imagePath) {
    await supabase.storage.from(MENU_BUCKET).remove([previousImage]);
  }

  refresh(slug);
  redirect(`/painel/${slug}/cardapio`);
}

export async function toggleProductAvailable(slug: string, id: string, available: boolean) {
  await requirePermission(slug, "manage_menu");
  const supabase = await createClient();
  await supabase.from("products").update({ available }).eq("id", id);
  refresh(slug);
}

export async function deleteProduct(slug: string, id: string) {
  await requirePermission(slug, "manage_menu");
  const supabase = await createClient();
  const { data } = await supabase.from("products").delete().eq("id", id).select("image_path").maybeSingle();
  if (data?.image_path) await supabase.storage.from(MENU_BUCKET).remove([data.image_path]);
  refresh(slug);
  redirect(`/painel/${slug}/cardapio`);
}
