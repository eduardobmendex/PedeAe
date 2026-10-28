import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { imageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { toggleProductAvailable } from "./actions";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "Cardápio" };

export default async function MenuPage({ params }: PageProps<"/painel/[slug]/cardapio">) {
  const { slug } = await params;
  const { organization } = await requirePermission(slug, "manage_menu");
  const supabase = await createClient();

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, active, sort_order")
      .eq("organization_id", organization.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("products")
      .select("id, category_id, name, price_cents, image_path, available, featured")
      .eq("organization_id", organization.id)
      .order("sort_order")
      .order("name"),
  ]);

  const cats = categories ?? [];
  const byCategory = new Map<string, NonNullable<typeof products>>();
  for (const p of products ?? []) byCategory.set(p.category_id, [...(byCategory.get(p.category_id) ?? []), p]);

  return (
    <>
      <PageHeader
        title="Cardápio"
        description="Categorias, produtos, preços e adicionais. As alterações aparecem no cardápio público na hora."
        actions={
          <>
            <ButtonLink href={`/m/${slug}`} target="_blank" variant="secondary">
              Ver cardápio público
            </ButtonLink>
            {cats.length > 0 && <ButtonLink href={`/painel/${slug}/cardapio/produto/novo`}>Novo produto</ButtonLink>}
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
        <CategoryManager slug={slug} categories={cats} />

        <div className="flex flex-col gap-6">
          {cats.length === 0 ? (
            <EmptyState title="Comece criando uma categoria">
              Exemplos: Pastéis, Lanches, Bebidas, Sobremesas. Depois cadastre os produtos de cada uma.
            </EmptyState>
          ) : (
            cats.map((cat) => {
              const items = byCategory.get(cat.id) ?? [];
              return (
                <section key={cat.id} id={`cat-${cat.id}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 font-semibold">
                      {cat.name}
                      {!cat.active && <Badge>oculta</Badge>}
                    </h2>
                    <Link
                      href={`/painel/${slug}/cardapio/produto/novo?categoria=${cat.id}`}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      + Produto
                    </Link>
                  </div>
                  {items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">
                      Nenhum produto nesta categoria.
                    </p>
                  ) : (
                    <Card className="p-0">
                      <ul className="divide-y divide-border">
                        {items.map((p) => {
                          const img = imageUrl(p.image_path);
                          return (
                            <li key={p.id} className="flex items-center gap-3 p-3">
                              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                                {img && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={img} alt="" className="size-full object-cover" loading="lazy" />
                                )}
                              </div>
                              <Link
                                href={`/painel/${slug}/cardapio/produto/${p.id}`}
                                className="min-w-0 flex-1 hover:underline"
                              >
                                <p className="flex items-center gap-2 truncate font-medium">
                                  {p.name}
                                  {p.featured && <Badge tone="warning">destaque</Badge>}
                                </p>
                                <p className="text-sm text-muted">{formatBRL(p.price_cents)}</p>
                              </Link>
                              <form action={toggleProductAvailable.bind(null, slug, p.id, !p.available)}>
                                <button
                                  type="submit"
                                  className="rounded-lg px-2 py-1 text-xs font-medium hover:bg-surface-2"
                                  title={p.available ? "Marcar como esgotado" : "Marcar como disponível"}
                                >
                                  {p.available ? <Badge tone="success">disponível</Badge> : <Badge tone="danger">esgotado</Badge>}
                                </button>
                              </form>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
