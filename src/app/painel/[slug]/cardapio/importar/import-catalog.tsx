"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { centsToInput, formatBRL, parseBRL } from "@/lib/money";
import { importCatalog } from "../actions";

export type CatalogItem = {
  key: string;
  category: string;
  category_sort: number;
  name: string;
  description: string;
  price_cents: number;
  options: { name: string; price_rule: string; items: { name: string; price_delta_cents: number }[] }[];
  types: string[];
  sort_order: number;
  image_path: string | null;
};

type EstablishmentType = { id: string; name: string; description: string };

export function ImportCatalog({
  slug,
  types,
  items,
  importedKeys,
}: {
  slug: string;
  types: EstablishmentType[];
  items: CatalogItem[];
  importedKeys: string[];
}) {
  const router = useRouter();
  const imported = useMemo(() => new Set(importedKeys), [importedKeys]);
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [importing, startImport] = useTransition();

  const visible = useMemo(
    () => items.filter((i) => i.types.some((t) => activeTypes.includes(t))),
    [items, activeTypes],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? visible.filter((i) => `${i.name} ${i.category}`.toLowerCase().includes(q)) : visible;
  }, [visible, query]);
  const byCategory = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of filtered) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()];
  }, [filtered]);

  const invalidPrices = [...selected].filter((key) => prices[key] !== undefined && parseBRL(prices[key]) === null);
  const toImport = [...selected].filter((key) => visible.some((i) => i.key === key));

  function toggleType(id: string) {
    const next = activeTypes.includes(id) ? activeTypes.filter((t) => t !== id) : [...activeTypes, id];
    const nextVisible = new Set(items.filter((i) => i.types.some((t) => next.includes(t))).map((i) => i.key));
    setActiveTypes(next);
    setSelected((prev) => {
      const s = new Set([...prev].filter((k) => nextVisible.has(k)));
      // Ao ligar um tipo, já marca os itens dele que ainda não foram importados.
      if (!activeTypes.includes(id)) {
        for (const item of items) if (item.types.includes(id) && !imported.has(item.key)) s.add(item.key);
      }
      return s;
    });
  }

  function setMany(keys: string[], on: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      for (const k of keys) {
        if (imported.has(k)) continue;
        if (on) s.add(k);
        else s.delete(k);
      }
      return s;
    });
  }

  function submit() {
    setError(undefined);
    const payload = toImport.map((key) => {
      const text = prices[key];
      const cents = text === undefined ? undefined : parseBRL(text);
      return cents === undefined || cents === null ? { key } : { key, price_cents: cents };
    });
    startImport(async () => {
      const result = await importCatalog(slug, payload);
      if (!result.ok) return setError(result.error);
      router.push(`/painel/${slug}/cardapio?importado=${result.imported}`);
    });
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <section aria-labelledby="tipos">
        <h2 id="tipos" className="mb-3 font-semibold">
          1. Tipo do estabelecimento
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => {
            const on = activeTypes.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleType(t.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  on ? "border-brand bg-active" : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {t.name}
                  <span
                    aria-hidden
                    className={`flex size-5 items-center justify-center rounded border text-xs ${on ? "border-brand bg-brand text-brand-contrast" : "border-border-strong"}`}
                  >
                    {on && "✓"}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-muted">{t.description}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-muted">Pode escolher mais de um (ex.: Bar + Pizzaria).</p>
      </section>

      {activeTypes.length === 0 ? (
        <EmptyState title="Escolha pelo menos um tipo">Os produtos sugeridos aparecem aqui.</EmptyState>
      ) : (
        <section aria-labelledby="produtos" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="produtos" className="font-semibold">
                2. Revise produtos e preços
              </h2>
              <p className="text-sm text-muted">
                Preços sugeridos com base no mercado da Bahia. Ajuste agora ou depois, no cardápio.
              </p>
            </div>
            <Input
              type="search"
              placeholder="Buscar produto"
              aria-label="Buscar produto"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs"
            />
          </div>

          {byCategory.map(([category, list]) => {
            const selectable = list.filter((i) => !imported.has(i.key)).map((i) => i.key);
            const allOn = selectable.length > 0 && selectable.every((k) => selected.has(k));
            return (
              <Card key={category} className="p-0">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <h3 className="font-medium">{category}</h3>
                  {selectable.length > 0 && (
                    <button type="button" className="text-sm text-muted hover:text-text" onClick={() => setMany(selectable, !allOn)}>
                      {allOn ? "Desmarcar todos" : "Marcar todos"}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-border">
                  {list.map((item) => {
                    const done = imported.has(item.key);
                    const priceByOption = item.price_cents === 0;
                    const text = prices[item.key] ?? centsToInput(item.price_cents);
                    const invalid = prices[item.key] !== undefined && parseBRL(text) === null;
                    return (
                      <li key={item.key} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${done ? "opacity-60" : ""}`}>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0"
                            checked={done || selected.has(item.key)}
                            disabled={done}
                            onChange={(e) => setMany([item.key], e.target.checked)}
                          />
                          {item.image_path && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.image_path} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg object-cover" />
                          )}
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2 font-medium">
                              {item.name}
                              {done && <Badge>já importado</Badge>}
                            </span>
                            {item.description && <span className="block truncate text-sm text-muted">{item.description}</span>}
                            {item.options.length > 0 && (
                              <span className="block text-xs text-muted">
                                {item.options.map((o) => `${o.name} (${o.items.length})`).join(" · ")}
                              </span>
                            )}
                          </span>
                        </label>
                        {priceByOption ? (
                          <span className="text-sm text-muted">
                            {formatBRL(Math.min(...item.options[0].items.map((i) => i.price_delta_cents)))} a{" "}
                            {formatBRL(Math.max(...item.options[0].items.map((i) => i.price_delta_cents)))}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1 text-sm">
                            <span className="text-muted">R$</span>
                            <Input
                              value={text}
                              inputMode="decimal"
                              disabled={done}
                              aria-label={`Preço de ${item.name}`}
                              aria-invalid={invalid}
                              onChange={(e) => setPrices((p) => ({ ...p, [item.key]: e.target.value }))}
                              className={`h-9 w-24 text-right ${invalid ? "border-danger" : ""}`}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </section>
      )}

      {activeTypes.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-semibold">{toImport.length}</span> produto(s) selecionado(s)
              {error ? (
                <span role="alert" className="block text-danger">
                  {error}
                </span>
              ) : invalidPrices.length > 0 ? (
                <span className="block text-danger">Corrija os preços em vermelho (formato 12,50).</span>
              ) : (
                <span className="block text-muted">Entram em categorias ocultas, para revisar antes de publicar.</span>
              )}
            </p>
            <Button type="button" onClick={submit} disabled={importing || toImport.length === 0 || invalidPrices.length > 0}>
              {importing ? "Importando…" : `Importar ${toImport.length} produto(s)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
