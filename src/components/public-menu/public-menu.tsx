"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCart, useRecentOrders } from "@/lib/cart";
import type { PublicMenu as Menu, PublicProduct } from "@/lib/menu";
import { minPriceCents } from "@/lib/menu-selection";
import { formatBRL } from "@/lib/money";
import { imageUrl } from "@/lib/storage";
import { CartSheet } from "./cart-sheet";
import { CategoryIcon, ChefHatIcon, CrownIcon, FlameIcon, PlusIcon, SearchIcon } from "./menu-icons";
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

  // Categoria visível agora (destaca o chip correspondente durante a rolagem).
  const [active, setActive] = useState<string | null>(menu.categories[0]?.id ?? null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (query) return;
    const sections = menu.categories
      .map((c) => document.getElementById(`cat-${c.id}`))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (first) setActive(first.target.id.slice(4));
      },
      { rootMargin: "-150px 0px -55% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [menu.categories, query]);

  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  // Estrutura única para DARK, RED e WHITE: só tokens do tema (brand, surface, text...), nada fixo por tema.
  return (
    <div
      className="@container relative z-10 mx-auto flex min-h-dvh w-full container-cardapio flex-col bg-bg lg:my-6 lg:min-h-[calc(100dvh-3rem)] lg:overflow-clip lg:rounded-[calc(var(--radius)*2)] lg:border lg:border-brand/35 lg:shadow-[0_0_60px_rgb(0_0_0/0.45)]"
    >
      <header
        className="relative overflow-hidden px-4 pt-8 pb-10 text-brand-contrast sm:px-8 sm:pt-12 sm:pb-12"
        style={{
          background: cover
            ? `linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.2)), url(${cover}) center / cover`
            : "linear-gradient(120deg, var(--brand), color-mix(in srgb, var(--brand) 62%, black))",
          color: cover ? "#fff" : undefined,
        }}
      >
        {/* Brilho diagonal sutil, como na referência. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1/2 left-1/3 h-[200%] w-1/3 rotate-12 bg-white/10 blur-2xl"
        />
        <ChefHatIcon className="pointer-events-none absolute top-6 right-6 hidden size-20 -rotate-12 opacity-25 sm:block" />

        <div className="relative flex items-center gap-3 sm:gap-5">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt=""
              className="size-16 shrink-0 rounded-full border-[3px] border-white/85 bg-surface object-cover shadow-lg sm:size-24"
            />
          )}
          {logo && <span aria-hidden className="h-12 w-px shrink-0 bg-current opacity-40 sm:h-16" />}
          <div className="min-w-0">
            {/* Lettering só no nome: logotipo e fonte escolhida pelo estabelecimento seguem como estão. */}
            <h1
              className="line-clamp-2 -rotate-1 text-2xl leading-tight break-words [text-shadow:0_2px_0_rgb(0_0_0/0.18)] sm:text-4xl"
              style={{ fontFamily: "var(--font-permanent-marker), var(--font-geist-sans), cursive" }}
            >
              {menu.organization.name}
            </h1>
            <p className="mt-1 text-[11px] font-medium tracking-[0.2em] uppercase opacity-90 sm:text-xs sm:tracking-[0.3em]">
              {tableName ? `Você está na ${tableName}` : "Cardápio digital"}
            </p>
          </div>
        </div>

        {/* Curva na base do cabeçalho, na cor do fundo. */}
        <svg aria-hidden viewBox="0 0 400 40" preserveAspectRatio="none" className="absolute inset-x-0 -bottom-px h-8 w-full sm:h-10">
          <path d="M0 40V22C90 40 210 42 300 22 340 13 375 4 400 0v40Z" style={{ fill: "var(--bg)" }} />
        </svg>

        {recent.length > 0 && (
          <Link
            href={`/pedido/${recent[0].token}`}
            className="absolute top-3 right-3 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
          >
            Acompanhar pedido #{recent[0].number}
          </Link>
        )}
      </header>

      <div className="sticky top-0 z-20 bg-bg/95 px-4 pt-2 pb-3 backdrop-blur sm:px-6">
        <label className="relative block">
          <span className="sr-only">Buscar no cardápio</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busque no cardápio..."
            style={{ borderRadius: "calc(var(--radius) * 2)" }}
            className="h-12 w-full border border-brand/40 bg-surface pr-4 pl-12 text-base outline-none placeholder:text-muted focus:border-brand"
          />
        </label>
        {!query && menu.categories.length > 1 && (
          <nav
            ref={navRef}
            aria-label="Categorias"
            className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6"
          >
            {menu.categories.map((c) => {
              const on = active === c.id;
              return (
                <a
                  key={c.id}
                  href={`#cat-${c.id}`}
                  aria-current={on ? "true" : undefined}
                  onClick={() => setActive(c.id)}
                  style={{ borderRadius: "calc(var(--radius) * 2)" }}
                  className={`flex shrink-0 items-center gap-2 border px-4 py-2 text-sm font-semibold transition ${on
                      ? "border-brand bg-brand text-brand-contrast shadow-[0_4px_14px_color-mix(in_srgb,var(--brand)_40%,transparent)]"
                      : "border-border-strong bg-surface text-text hover:border-brand/60"
                    }`}
                >
                  <CategoryIcon name={c.name} className={`size-4.5 ${on ? "" : "text-brand-text"}`} />
                  {c.name}
                </a>
              );
            })}
          </nav>
        )}
      </div>

      <main className="flex flex-1 flex-col gap-9 px-4 pt-4 pb-8 sm:px-6">
        {menu.categories.length === 0 && (
          <p className="py-16 text-center text-muted">O cardápio ainda está sendo preparado. Volte em instantes.</p>
        )}
        {query && categories.length === 0 && (
          <p className="py-10 text-center text-muted">Nada encontrado para “{query}”.</p>
        )}

        {featured.length > 0 && (
          <section aria-labelledby="destaques">
            <SectionTitle id="destaques" icon={<FlameIcon className="size-6" />}>
              Destaques
            </SectionTitle>
            <div className="-mx-4 flex scroll-px-4 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6">
              {featured.map((p) => (
                <FeaturedCard key={p.id} product={p} single={featured.length === 1} onOpen={() => setSelected(p)} />
              ))}
            </div>
          </section>
        )}

        {categories.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`h-${c.id}`} className="scroll-mt-40">
            <SectionTitle id={`h-${c.id}`} icon={<CategoryIcon name={c.name} className="size-6" />}>
              {c.name}
            </SectionTitle>
            <ul className="grid gap-4 @3xl:grid-cols-2">
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

      <footer className={`bg-footer px-4 pt-4 text-center text-xs text-muted ${cart.count > 0 ? "pb-28" : "pb-8"}`}>
        Cardápio digital por PedeAe
      </footer>

      {table && cart.count > 0 && (
        <div className="container-cardapio fixed inset-x-0 bottom-0 z-30 mx-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
  return varies ? `a partir de ${formatBRL(minPriceCents(p))}` : formatBRL(p.price_cents);
}

/** Título de seção: ícone + nome, com o traço da cor do tema embaixo. */
function SectionTitle({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-4 flex items-center gap-2.5 text-xl font-bold sm:text-2xl">
      <span className="flex flex-col items-center gap-1 text-brand-text">
        {icon}
        <span className="h-1 w-7 rounded-full bg-brand" />
      </span>
      <span className="flex flex-col gap-1">
        {children}
        <span className="h-1 w-full max-w-24 rounded-full bg-brand/60" />
      </span>
    </h2>
  );
}

/** Selo de preço e botão "+" (visual: o card inteiro é o botão que abre o produto). */
function Price({ product }: { product: PublicProduct }) {
  return (
    <span
      style={{ borderRadius: "calc(var(--radius) * 0.6)" }}
      className="inline-block bg-brand px-3 py-1 text-base font-bold text-brand-contrast shadow-[0_3px_10px_color-mix(in_srgb,var(--brand)_35%,transparent)] sm:text-lg"
    >
      {priceLabel(product)}
    </span>
  );
}

function AddMark() {
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-contrast shadow-[0_4px_14px_color-mix(in_srgb,var(--brand)_45%,transparent)] transition group-hover:scale-110"
    >
      <PlusIcon className="size-5" />
    </span>
  );
}

const CARD =
  "group relative flex w-full overflow-hidden border border-brand/45 bg-[linear-gradient(135deg,var(--surface),var(--surface-2))] text-left shadow-card transition hover:border-brand";

function ProductCard({ product, onOpen }: { product: PublicProduct; onOpen: () => void }) {
  const img = imageUrl(product.image_path);
  return (
    <button type="button" onClick={onOpen} style={{ borderRadius: "calc(var(--radius) * 1.5)" }} className={`${CARD} min-h-36`}>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        <p className="text-lg font-bold">{product.name}</p>
        {product.description && <p className="mt-1 line-clamp-2 text-sm text-muted sm:text-base">{product.description}</p>}
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <Price product={product} />
          {!img && <AddMark />}
        </div>
      </div>
      {img && (
        <div className="relative w-[38%] max-w-56 min-w-28 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-105 [mask-image:linear-gradient(to_right,transparent,black_35%)]"
          />
          <span className="absolute right-3 bottom-3 sm:right-auto sm:-left-2">
            <AddMark />
          </span>
        </div>
      )}
    </button>
  );
}

function FeaturedCard({ product, single, onOpen }: { product: PublicProduct; single: boolean; onOpen: () => void }) {
  const img = imageUrl(product.image_path);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ borderRadius: "calc(var(--radius) * 1.5)" }}
      className={`${CARD} min-h-40 shrink-0 snap-start ${single ? "" : "w-[88%] @xl:w-[75%] @3xl:w-[calc(50%-0.375rem)]"}`}
    >
      {img && (
        <div className="relative w-2/5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-105 [mask-image:linear-gradient(to_left,transparent,black_35%)]"
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        <span className="mb-1 inline-flex items-center gap-1 self-end rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-contrast">
          <CrownIcon className="size-3.5" />
          Destaque
        </span>
        <p className="text-lg font-bold sm:text-xl">{product.name}</p>
        {product.description && <p className="mt-1 line-clamp-2 text-sm text-muted sm:text-base">{product.description}</p>}
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <Price product={product} />
          <AddMark />
        </div>
      </div>
    </button>
  );
}
