import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatBRL } from "@/lib/money";
import { imageUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { publishCategories, toggleProductAvailable, toggleProductSoldOut } from "./actions";
import { CategoryManager } from "./category-manager";
import { MenuTypeSwitcher } from "./menu-type-switcher";

export const metadata: Metadata = { title: "Cardápio" };

export default async function MenuPage({ params, searchParams }: PageProps<"/painel/[slug]/cardapio">) {
  const { slug } = await params;
  const { importado } = await searchParams;
  const importedCount = typeof importado === "string" ? Number.parseInt(importado, 10) : NaN;
  const { organization, membership } = await requirePermission(slug, "manage_menu");
  // Trocar o tipo mexe no cardápio e no visual: precisa das duas permissões.
  const canSwitchType = can(membership, "manage_theme");
  const supabase = await createClient();

  const [{ data: categories }, { data: products }, { data: types }, { data: settings }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, active, sort_order")
      .eq("organization_id", organization.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("products")
      .select("id, category_id, name, price_cents, image_path, available, featured, sold_out")
      .eq("organization_id", organization.id)
      .order("sort_order")
      .order("name"),
    supabase.from("establishment_types").select("id, name, description").order("sort_order"),
    supabase.from("organization_settings").select("settings").eq("organization_id", organization.id).single(),
  ]);
  const currentType = (settings?.settings as Record<string, unknown> | null)?.establishment_type;

  const cats = categories ?? [];
  const byCategory = new Map<string, NonNullable<typeof products>>();
  for (const p of products ?? []) byCategory.set(p.category_id, [...(byCategory.get(p.category_id) ?? []), p]);
  const hiddenWithProducts = cats.filter((c) => !c.active && byCategory.has(c.id));

  return (
    <>
      <PageHeader
        title="Cardápio"
        description="Categorias, produtos, preços e adicionais. Tudo é salvo na hora; só categorias publicadas aparecem para os clientes."
        actions={
          <>
            <ButtonLink href={`/m/${slug}`} target="_blank" variant="secondary">
              Ver cardápio público
            </ButtonLink>
            <ButtonLink href={`/painel/${slug}/cardapio/importar`} variant="secondary">
              Importar do catálogo
            </ButtonLink>
            {cats.length > 0 && <ButtonLink href={`/painel/${slug}/cardapio/produto/novo`}>Novo produto</ButtonLink>}
          </>
        }
      />

      {Number.isFinite(importedCount) && (
        <p role="status" className="mb-6 rounded-lg bg-success-soft px-4 py-3 text-sm text-success">
          {importedCount === 0
            ? "Nenhum produto novo: os selecionados já estavam no cardápio."
            : `${importedCount} produto(s) importado(s) e salvo(s). Revise os preços e publique as categorias para os clientes verem.`}
        </p>
      )}

      {hiddenWithProducts.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          <p>
            {hiddenWithProducts.length} categoria(s) com produtos estão ocultas: os clientes ainda não veem esses itens no
            cardápio.
          </p>
          <form action={publishCategories.bind(null, slug, null)}>
            <Button type="submit">Publicar todas</Button>
          </form>
        </div>
      )}

      {canSwitchType && (types?.length ?? 0) > 0 && (
        <MenuTypeSwitcher slug={slug} types={types ?? []} current={typeof currentType === "string" ? currentType : null} />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
        <CategoryManager slug={slug} categories={cats} />

        <div className="flex flex-col gap-6">
          {cats.length === 0 ? (
            <EmptyState
              title="Cardápio vazio"
              action={<ButtonLink href={`/painel/${slug}/cardapio/importar`}>Importar do catálogo</ButtonLink>}
            >
              Importe um cardápio pronto de pizzaria, bar, hamburgueria, pastelaria ou comida baiana, ou crie suas categorias
              ao lado.
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
                    <div className="flex items-center gap-3">
                      {!cat.active && (
                        <form action={publishCategories.bind(null, slug, cat.id)}>
                          <Button type="submit" variant="secondary" className="h-8 px-3">
                            Publicar
                          </Button>
                        </form>
                      )}
                      <Link
                        href={`/painel/${slug}/cardapio/produto/novo?categoria=${cat.id}`}
                        className="text-sm font-medium text-brand-text hover:underline"
                      >
                        + Produto
                      </Link>
                    </div>
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
                              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                                <form action={toggleProductSoldOut.bind(null, slug, p.id, !p.sold_out)}>
                                  <button
                                    type="submit"
                                    className="rounded-lg px-1.5 py-1 text-xs font-medium hover:bg-hover"
                                    title={p.sold_out ? "Voltar a vender" : "Marcar como esgotado (o cliente vê, mas não pede)"}
                                  >
                                    {p.sold_out ? <Badge tone="danger">esgotado</Badge> : <Badge tone="success">à venda</Badge>}
                                  </button>
                                </form>
                                <form action={toggleProductAvailable.bind(null, slug, p.id, !p.available)}>
                                  <button
                                    type="submit"
                                    className="rounded-lg px-1.5 py-1 text-xs font-medium hover:bg-hover"
                                    title={p.available ? "Ocultar do cardápio" : "Mostrar no cardápio"}
                                  >
                                    {p.available ? <Badge>visível</Badge> : <Badge tone="warning">oculto</Badge>}
                                  </button>
                                </form>
                              </div>
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
