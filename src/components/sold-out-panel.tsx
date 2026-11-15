"use client";

import { useMemo, useState, useTransition } from "react";
import { setSoldOut } from "@/app/painel/[slug]/service-actions";

export type StockProduct = { id: string; name: string; category: string; sold_out: boolean };

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Esgotado com um toque: o cliente vê "Esgotado" no cardápio na hora e não consegue pedir. */
export function SoldOutPanel({ slug, products }: { slug: string; products: StockProduct[] }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState(() => new Map(products.map((p) => [p.id, p.sold_out])));
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  const soldCount = [...state.values()].filter(Boolean).length;

  const groups = useMemo(() => {
    const q = normalize(query.trim());
    const map = new Map<string, StockProduct[]>();
    for (const p of products) {
      if (q && !normalize(p.name).includes(q)) continue;
      map.set(p.category, [...(map.get(p.category) ?? []), p]);
    }
    return [...map];
  }, [products, query]);

  function toggle(p: StockProduct) {
    const next = !state.get(p.id);
    setError(undefined);
    setState((m) => new Map(m).set(p.id, next)); // otimista
    start(async () => {
      const r = await setSoldOut(slug, p.id, next).catch(() => ({ ok: false }));
      if (!r.ok) {
        setState((m) => new Map(m).set(p.id, !next));
        setError(`Não foi possível atualizar "${p.name}". Tente de novo.`);
      }
    });
  }

  return (
    <details className="group rounded-xl border border-border bg-surface" open={soldCount > 0}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 select-none">
        <span className="font-semibold">Disponibilidade dos produtos</span>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${soldCount ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted"}`}>
          {soldCount ? `${soldCount} esgotado(s)` : "Tudo disponível"}
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar produto…"
          aria-label="Buscar produto"
          className="h-10 rounded-lg border border-input-border bg-input px-3 text-sm"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(([category, list]) => (
            <div key={category}>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{category}</p>
              <ul>
                {list.map((p) => {
                  const sold = state.get(p.id) ?? false;
                  return (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                        <span className={`min-w-0 truncate text-sm ${sold ? "text-muted line-through" : ""}`}>{p.name}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs">
                          <span className={sold ? "font-semibold text-danger" : "text-muted"}>{sold ? "Esgotado" : "Disponível"}</span>
                          <input
                            type="checkbox"
                            role="switch"
                            checked={!sold}
                            onChange={() => toggle(p)}
                            aria-label={`${p.name} disponível`}
                            className="peer sr-only"
                          />
                          <span
                            aria-hidden
                            className="relative h-5 w-9 rounded-full bg-danger transition peer-checked:bg-success peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                          />
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted">Nenhum produto encontrado.</p>}
        </div>
      </div>
    </details>
  );
}
