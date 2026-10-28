import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProductForm, type OptionGroupInput } from "../product-form";

export const metadata: Metadata = { title: "Editar produto" };

export default async function EditProductPage({ params }: PageProps<"/painel/[slug]/cardapio/produto/[id]">) {
  const { slug, id } = await params;
  const { organization } = await requirePermission(slug, "manage_menu");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: product }, { data: categories }, { data: options }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, description, category_id, price_cents, available, featured, image_path")
      .eq("id", id)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id, name")
      .eq("organization_id", organization.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("product_options")
      .select("name, min_select, max_select, sort_order, product_option_items (name, price_delta_cents, available, sort_order)")
      .eq("product_id", id)
      .order("sort_order"),
  ]);
  if (!product) notFound();

  const groups: OptionGroupInput[] = (options ?? []).map((o) => ({
    name: o.name,
    min_select: o.min_select,
    max_select: o.max_select,
    items: [...(o.product_option_items ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ name, price_delta_cents, available }) => ({ name, price_delta_cents, available })),
  }));

  return (
    <>
      <PageHeader title={product.name} description="Editar produto" />
      <ProductForm
        slug={slug}
        organizationId={organization.id}
        categories={categories ?? []}
        product={{ ...product, options: groups }}
      />
    </>
  );
}
