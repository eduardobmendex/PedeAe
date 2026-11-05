import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ImportCatalog, type CatalogItem } from "./import-catalog";

export const metadata: Metadata = { title: "Importar do catálogo" };

export default async function ImportCatalogPage({ params }: PageProps<"/painel/[slug]/cardapio/importar">) {
  const { slug } = await params;
  const { organization } = await requirePermission(slug, "manage_menu");
  const supabase = await createClient();

  const [{ data: types }, { data: items }, { data: imported }] = await Promise.all([
    supabase.from("establishment_types").select("id, name, description").order("sort_order"),
    supabase
      .from("catalog_items")
      .select("key, category, category_sort, name, description, price_cents, options, types, sort_order, image_path")
      .order("category_sort")
      .order("sort_order"),
    supabase
      .from("products")
      .select("source_catalog_key")
      .eq("organization_id", organization.id)
      .not("source_catalog_key", "is", null),
  ]);

  return (
    <>
      <PageHeader
        title="Importar do catálogo"
        description="Escolha o tipo do estabelecimento, revise os produtos e os preços sugeridos e importe. Tudo entra oculto para você revisar antes de publicar."
      />
      <ImportCatalog
        slug={slug}
        types={types ?? []}
        items={(items ?? []) as CatalogItem[]}
        importedKeys={(imported ?? []).map((p) => p.source_catalog_key as string)}
      />
    </>
  );
}
