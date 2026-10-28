"use client";

import { useEffect, useRef, useState } from "react";
import type { CartLine } from "@/lib/cart";
import type { PublicProduct } from "@/lib/menu";
import { missingOptions, optionRuleLabel, toggleItem, unitPriceCents, type Selection } from "@/lib/menu-selection";
import { formatBRL } from "@/lib/money";
import { imageUrl } from "@/lib/storage";

export type NewCartLine = Omit<CartLine, "key">;

/**
 * Detalhe do produto em <dialog> (bottom sheet no celular).
 * Sem `onAdd`, funciona só como vitrine (cardápio geral sem mesa).
 */
export function ProductSheet({
  product,
  onClose,
  onAdd,
  disabledReason,
}: {
  product: PublicProduct | null;
  onClose: () => void;
  onAdd?: (line: NewCartLine) => void;
  disabledReason?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (product && !dialog.open) dialog.showModal();
    if (!product && dialog.open) dialog.close();
  }, [product]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      aria-label={product?.name}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-surface p-0 text-text backdrop:bg-black/50 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      {/* key reinicia a seleção a cada produto aberto */}
      {product && (
        <SheetBody
          key={product.id}
          product={product}
          onClose={() => ref.current?.close()}
          onAdd={onAdd}
          disabledReason={disabledReason}
        />
      )}
    </dialog>
  );
}

function SheetBody({
  product,
  onClose,
  onAdd,
  disabledReason,
}: {
  product: PublicProduct;
  onClose: () => void;
  onAdd?: (line: NewCartLine) => void;
  disabledReason?: string;
}) {
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const img = imageUrl(product.image_path);
  const missing = missingOptions(product, selection);
  const unit = unitPriceCents(product, selection);

  function add() {
    if (!onAdd || missing.length) return;
    onAdd({
      productId: product.id,
      name: product.name,
      quantity,
      notes: notes.trim(),
      unitPriceCents: unit,
      options: product.options
        .filter((o) => (selection[o.id]?.length ?? 0) > 0)
        .map((o) => ({ option_id: o.id, item_ids: selection[o.id] })),
      optionLabels: product.options.flatMap((o) =>
        (selection[o.id] ?? []).map((id) => o.items.find((i) => i.id === id)?.name ?? ""),
      ),
    });
    onClose();
  }

  const label = !onAdd
    ? (disabledReason ?? "Indisponível")
    : missing.length
      ? `Escolha ${missing[0].name.toLowerCase()}`
      : "Adicionar";

  return (
    <div className="flex max-h-[92dvh] flex-col">
      <div className="overflow-y-auto">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="aspect-[4/3] w-full object-cover" />
        )}
        <div className="flex flex-col gap-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{product.name}</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="-mt-1 -mr-2 rounded-full px-3 py-1 text-xl text-muted">
              ×
            </button>
          </div>
          {product.description && <p className="text-muted">{product.description}</p>}
          <p className="mt-1 font-semibold">{formatBRL(product.price_cents)}</p>
        </div>

        {product.options.map((option) => {
          const chosen = selection[option.id] ?? [];
          const single = option.max_select === 1;
          return (
            <fieldset key={option.id} className="border-t border-border">
              <legend className="contents">
                <div className="flex items-center justify-between gap-2 bg-surface-2 px-5 py-3">
                  <span>
                    <span className="block font-medium">{option.name}</span>
                    <span className="text-xs text-muted">{optionRuleLabel(option)}</span>
                  </span>
                  {option.min_select > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        chosen.length >= option.min_select ? "bg-success-soft text-success" : "bg-text text-bg"
                      }`}
                    >
                      {chosen.length >= option.min_select ? "OK" : "Obrigatório"}
                    </span>
                  )}
                </div>
              </legend>
              <ul>
                {option.items.map((item) => {
                  const checked = chosen.includes(item.id);
                  const blocked = !checked && !single && chosen.length >= option.max_select;
                  return (
                    <li key={item.id}>
                      <label
                        className={`flex items-center justify-between gap-3 px-5 py-3 ${blocked ? "opacity-50" : "cursor-pointer"}`}
                      >
                        <span>
                          {item.name}
                          {item.price_delta_cents > 0 && (
                            <span className="block text-sm text-muted">+ {formatBRL(item.price_delta_cents)}</span>
                          )}
                        </span>
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={option.id}
                          checked={checked}
                          disabled={blocked}
                          onChange={() => setSelection((s) => toggleItem(s, option, item.id))}
                          className="size-5 accent-[var(--brand)]"
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}

        {onAdd && (
          <div className="border-t border-border px-5 py-4">
            <label htmlFor="item-notes" className="mb-1.5 block text-sm font-medium">
              Alguma observação?
            </label>
            <textarea
              id="item-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={140}
              rows={2}
              placeholder="Ex.: sem cebola, ponto da carne…"
              style={{ borderRadius: "var(--radius)" }}
              className="w-full border border-border-strong bg-surface px-3 py-2 text-base outline-none placeholder:text-muted focus:border-text"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border p-4">
        {onAdd && (
          <div className="flex items-center rounded-lg border border-border-strong">
            <button
              type="button"
              aria-label="Diminuir quantidade"
              className="px-3 py-2 text-lg disabled:opacity-40"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => q - 1)}
            >
              −
            </button>
            <span className="w-6 text-center font-medium" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              aria-label="Aumentar quantidade"
              className="px-3 py-2 text-lg disabled:opacity-40"
              disabled={quantity >= 50}
              onClick={() => setQuantity((q) => q + 1)}
            >
              +
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={add}
          disabled={!onAdd || missing.length > 0}
          style={{ borderRadius: "var(--radius)" }}
          className="flex h-12 flex-1 items-center justify-between gap-2 bg-brand px-4 font-semibold text-brand-contrast disabled:opacity-60"
        >
          <span className="truncate">{label}</span>
          <span>{formatBRL(unit * quantity)}</span>
        </button>
      </div>
    </div>
  );
}
