"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ProductSheet } from "@/components/public-menu/product-sheet";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useCart } from "@/lib/cart";
import type { PublicMenu, PublicProduct } from "@/lib/menu";
import { formatBRL } from "@/lib/money";
import { createManualOrder } from "../actions";

export function ManualOrderForm({
  slug,
  menu,
  tables,
  initialTableId,
}: {
  slug: string;
  menu: PublicMenu;
  tables: { id: string; name: string }[];
  initialTableId: string;
}) {
  const router = useRouter();
  const cart = useCart(`pedeae:manual:${slug}`);
  const [tableId, setTableId] = useState(initialTableId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [error, setError] = useState<string>();
  const [sending, startSending] = useTransition();

  const products = useMemo(() => {
    const q = query.trim().toLowerCase();
    return menu.categories.flatMap((c) =>
      c.products.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => ({ ...p, category: c.name })),
    );
  }, [menu.categories, query]);

  function submit() {
    setError(undefined);
    const idempotencyKey = cart.ensureKey();
    startSending(async () => {
      try {
        const result = await createManualOrder(slug, tableId || null, {
          idempotencyKey,
          customerName: cart.state.customerName,
          notes: cart.state.notes,
          items: cart.state.lines.map((l) => ({
            product_id: l.productId,
            quantity: l.quantity,
            notes: l.notes || undefined,
            options: l.options,
          })),
        });
        if (!result.ok) return setError(result.error);
        cart.clear();
        router.push(`/painel/${slug}/pedidos`);
      } catch {
        setError("Sem conexão. Tente enviar novamente (o pedido não será duplicado).");
      }
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Input type="search" placeholder="Buscar produto" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar produto" />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p)}
              className="flex flex-col items-start rounded-xl border border-border bg-surface p-3 text-left transition hover:border-border-strong"
            >
              <span className="text-xs text-muted">{p.category}</span>
              <span className="font-medium">{p.name}</span>
              <span className="text-sm">{formatBRL(p.price_cents)}</span>
            </button>
          ))}
        </div>
      </div>

      <Card className="flex flex-col gap-4 lg:sticky lg:top-8">
        <Field label="Mesa" htmlFor="table">
          <Select id="table" value={tableId} onChange={(e) => setTableId(e.target.value)} className="w-full">
            <option value="">Sem mesa (balcão / retirada)</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome do cliente (opcional)" htmlFor="customer">
          <Input
            id="customer"
            value={cart.state.customerName}
            maxLength={60}
            onChange={(e) => cart.setField("customerName", e.target.value)}
          />
        </Field>

        {cart.state.lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-sm text-muted">
            Toque nos produtos para adicionar.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {cart.state.lines.map((l) => (
              <li key={l.key} className="flex items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {l.quantity}× {l.name}
                  </p>
                  {l.optionLabels.length > 0 && <p className="truncate text-muted">{l.optionLabels.join(", ")}</p>}
                  {l.notes && <p className="truncate text-muted italic">{l.notes}</p>}
                </div>
                <span>{formatBRL(l.unitPriceCents * l.quantity)}</span>
                <button
                  type="button"
                  aria-label={`Remover ${l.name}`}
                  className="rounded px-2 text-muted hover:text-danger"
                  onClick={() => cart.setQuantity(l.key, 0)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <Field label="Observações" htmlFor="order-notes">
          <Textarea
            id="order-notes"
            rows={2}
            maxLength={280}
            value={cart.state.notes}
            onChange={(e) => cart.setField("notes", e.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between font-semibold">
          <span>Total</span>
          <span>{formatBRL(cart.totalCents)}</span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="button" onClick={submit} disabled={sending || cart.state.lines.length === 0}>
          {sending ? "Enviando…" : "Enviar para a cozinha"}
        </Button>
      </Card>

      <ProductSheet product={selected} onClose={() => setSelected(null)} onAdd={(line) => cart.add(line)} />
    </div>
  );
}
