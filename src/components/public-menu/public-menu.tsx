"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCart, useRecentOrders } from "@/lib/cart";
import type { PublicMenu as Menu, PublicProduct } from "@/lib/menu";
import { formatBRL } from "@/lib/money";
import { imageUrl } from "@/lib/storage";
import { CartSheet } from "./cart-sheet";
import { ProductSheet } from "./product-sheet";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function PublicMenu({ menu, table }: { menu: Menu; table: { name: string; token: string } | null }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const cartKey = `pedeae:cart:${table?.token ?? "none"}`;
  const cart = useCart(cartKey);
  const recent = useRecentOrders(menu.organization.slug);
  const tableName = table?.name ?? null;
  const cover = imageUrl(menu.branding.cover_path);
  const logo = imageUrl(menu.branding.logo_path);

  const categories = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return menu.categories;
    return menu.categories
      .map((c) => ({
        ...c,
        products: c.products.filter((p) => normalize(`${p.name} ${p.description}`).includes(q)),
      }))
      .filter((c) => c.products.length > 0);
  }, [menu.categories, query]);

  const featured = query ? [] : menu.categories.flatMap((c) => c.products.filter((p) => p.featured));

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header
        className="relative bg-brand bg-cover bg-center px-4 pt-14 pb-5 text-brand-contrast"
        style={
          cover
            ? { backgroundImage: `linear-gradient(to top, rgb(0 0 0 / 0.7), rgb(0 0 0 / 0.1)), url(${cover})`, color: "#fff" }
            : undefined
        }
      >
        <div className="flex items-center gap-3">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="size-14 rounded-full border-2 border-white/80 bg-surface object-cover" />
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{menu.organization.name}</h1>
            <p className="text-sm opacity-85">{tableName ? `Você está na ${tableName}` : "Cardápio"}</p>
          </div>
        </div>
        {recent.length > 0 && (
          <Link
            href={`/pedido/${recent[0].token}`}
            className="absolute top-3 right-3 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
          >
            Acompanhar pedido #{recent[0].number}
          </Link>
        )}
      </header>

      <div className="sticky top-0 z-10 border-b border-border bg-bg/95 px-4 pt-3 pb-2 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar no cardápio"
          aria-label="Buscar no cardápio"
          style={{ borderRadius: "var(--radius)" }}
          className="h-11 w-full border border-border-strong bg-surface px-4 text-base outline-none placeholder:text-muted focus:border-text"
        />
        {!query && menu.categories.length > 1 && (
          <nav aria-label="Categorias" className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {menu.categories.map((c) => (
              <a
                key={c.id}
                href={`#cat-${c.id}`}
                style={{ borderRadius: "var(--radius)" }}
                className="shrink-0 bg-surface-2 px-3.5 py-1.5 text-sm font-medium text-muted hover:text-text"
              >
                {c.name}
              </a>
            ))}
          </nav>
        )}
      </div>

      <main className="flex flex-1 flex-col gap-8 px-4 py-6">
        {menu.categories.length === 0 && (
          <p className="py-16 text-center text-muted">O cardápio ainda está sendo preparado. Volte em instantes.</p>
        )}
        {query && categories.length === 0 && (
          <p className="py-10 text-center text-muted">Nada encontrado para “{query}”.</p>
        )}

        {featured.length > 0 && (
          <section aria-labelledby="destaques">
            <h2 id="destaques" className="mb-3 text-lg font-semibold">
              Destaques
            </h2>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
              {featured.map((p) => (
                <FeaturedCard key={p.id} product={p} onOpen={() => setSelected(p)} />
              ))}
            </div>
          </section>
        )}

        {categories.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`h-${c.id}`} className="scroll-mt-32">
            <h2 id={`h-${c.id}`} className="mb-3 text-lg font-semibold">
              {c.name}
            </h2>
            <ul className="flex flex-col gap-3">
              {c.products.map((p) => (
                <li key={p.id}>
                  <ProductCard product={p} onOpen={() => setSelected(p)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {!table && menu.categories.length > 0 && (
        <p className="mx-4 mb-4 rounded-lg bg-surface-2 px-4 py-3 text-center text-sm text-muted">
          Para fazer um pedido, escaneie o QR Code da sua mesa.
        </p>
      )}

      <footer className={`px-4 pt-4 text-center text-xs text-muted ${cart.count > 0 ? "pb-28" : "pb-8"}`}>
        Cardápio digital por PedeAe
      </footer>

      {table && cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            style={{ borderRadius: "var(--radius)" }}
            className="flex h-14 w-full items-center justify-between bg-brand px-5 font-semibold text-brand-contrast shadow-lg"
          >
            <span className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-black/20 text-sm">{cart.count}</span>
              Ver pedido
            </span>
            <span>{formatBRL(cart.totalCents)}</span>
          </button>
        </div>
      )}

      <ProductSheet
        product={selected}
        onClose={() => setSelected(null)}
        onAdd={table ? (line) => cart.add(line) : undefined}
        disabledReason="Peça pelo QR Code da mesa"
      />
      {table && (
        <CartSheet
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          cartKey={cartKey}
          tableToken={table.token}
          tableName={table.name}
          slug={menu.organization.slug}
        />
      )}
    </div>
  );
}

function priceLabel(p: PublicProduct) {
  // Se há grupo obrigatório com acréscimos, o preço final pode variar.
  const varies = p.options.some((o) => o.min_select > 0 && o.items.some((i) => i.price_delta_cents > 0));
  return varies ? `a partir de ${formatBRL(p.price_cents)}` : formatBRL(p.price_cents);
}

function ProductCard({ product, onOpen }: { product: PublicProduct; onOpen: () => void }) {
  const img = imageUrl(product.image_path);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ borderRadius: "var(--radius)" }}
      className="flex w-full items-start gap-3 border border-border bg-surface p-3 text-left shadow-card transition hover:border-border-strong"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{product.name}</p>
        {product.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{product.description}</p>}
        <p className="mt-2 font-semibold">{priceLabel(product)}</p>
      </div>
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img}
          alt=""
          loading="lazy"
          style={{ borderRadius: "calc(var(--radius) * 0.75)" }}
          className="size-24 shrink-0 object-cover"
        />
      )}
    </button>
  );
}

function FeaturedCard({ product, onOpen }: { product: PublicProduct; onOpen: () => void }) {
  const img = imageUrl(product.image_path);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ borderRadius: "var(--radius)" }}
      className="flex w-40 shrink-0 flex-col overflow-hidden border border-border bg-surface text-left shadow-card"
    >
      <div className="aspect-square w-full bg-surface-2">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" loading="lazy" className="size-full object-cover" />
        )}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-1 text-sm font-medium">{product.name}</p>
        <p className="text-sm font-semibold">{formatBRL(product.price_cents)}</p>
      </div>
    </button>
  );
}
