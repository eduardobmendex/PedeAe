import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Novo produto" };

export default async function NewProductPage({ params, searchParams }: PageProps<"/painel/[slug]/cardapio/produto/novo">) {
  const { slug } = await params;
  const { categoria } = await searchParams;
  const { organization } = await requirePermission(slug, "manage_menu");
  const supabase = await createClient();

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("organization_id", organization.id)
    .order("sort_order")
    .order("name");
  if (!categories?.length) redirect(`/painel/${slug}/cardapio`);

  const categoryId = categories.some((c) => c.id === categoria) ? String(categoria) : categories[0].id;

  return (
    <>
      <PageHeader title="Novo produto" />
      <ProductForm
        slug={slug}
        organizationId={organization.id}
        categories={categories}
        product={{
          id: null,
          name: "",
          description: "",
          category_id: categoryId,
          price_cents: null,
          available: true,
          featured: false,
          image_path: null,
          options: [],
        }}
      />
    </>
  );
}
