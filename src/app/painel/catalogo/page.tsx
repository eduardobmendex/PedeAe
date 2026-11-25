import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/header";
import { ButtonLink, Skeleton } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CatalogBoard, type CatalogRow } from "./catalog-board";

export const metadata: Metadata = { title: "Catálogo base" };

export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <main aria-busy="true" className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5]" />
            ))}
          </div>
        </main>
      }
    >
      <CatalogContent />
    </Suspense>
  );
}

async function CatalogContent() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: types }, { data: items }, { data: usage }] = await Promise.all([
    supabase.from("establishment_types").select("id, name").order("sort_order"),
    supabase
      .from("catalog_items")
      .select("key, category, category_sort, name, description, types, sort_order, image_path, default_image_path, custom_image_path")
      .order("category_sort")
      .order("sort_order"),
    supabase.rpc("platform_catalog_usage"),
  ]);

  const byKey = new Map(((usage ?? []) as { key: string; organizations: number; using_catalog_photo: number }[]).map((u) => [u.key, u]));
  const rows: CatalogRow[] = (items ?? []).map((i) => ({
    key: i.key,
    category: i.category,
    name: i.name,
    description: i.description,
    types: i.types,
    imagePath: i.image_path,
    defaultImagePath: i.default_image_path,
    customImagePath: i.custom_image_path,
    organizations: byKey.get(i.key)?.organizations ?? 0,
    usingCatalogPhoto: byKey.get(i.key)?.using_catalog_photo ?? 0,
  }));

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Catálogo base</h1>
            <p className="mt-1 text-sm text-muted">
              Foto padrão de cada produto do catálogo. É a foto que o produto recebe quando um estabelecimento importa o cardápio.
            </p>
          </div>
          <ButtonLink href="/painel" variant="ghost">
            ← Administração
          </ButtonLink>
        </div>
        <CatalogBoard types={types ?? []} rows={rows} />
      </main>
    </>
  );
}
