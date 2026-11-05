"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { placeCustomerOrder } from "@/app/q/[token]/actions";
import { rememberOrder, useCart } from "@/lib/cart";
import { formatBRL } from "@/lib/money";

export function CartSheet({
  open,
  onClose,
  cartKey,
  tableToken,
  tableName,
  slug,
}: {
  open: boolean;
  onClose: () => void;
  cartKey: string;
  tableToken: string;
  tableName: string;
  slug: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cart = useCart(cartKey);
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [sending, startSending] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function submit() {
    setError(undefined);
    const idempotencyKey = cart.ensureKey();
    startSending(async () => {
      try {
        const result = await placeCustomerOrder(tableToken, {
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
        if (!result.ok) {
          setError(result.error);
          return;
        }
        rememberOrder(slug, { token: result.publicToken, number: result.orderNumber, at: Date.now() });
        cart.clear();
        router.push(`/pedido/${result.publicToken}`);
      } catch {
        // Falha de rede: o pedido pode ter chegado. Reenviar usa a mesma chave, sem duplicar.
        setError("Sem conexão com o servidor. Verifique a internet e toque em enviar novamente.");
      }
    });
  }

  const empty = cart.state.lines.length === 0;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      aria-label="Seu pedido"
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-surface p-0 text-text backdrop:bg-black/50 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Seu pedido</h2>
            <p className="text-sm text-muted">{tableName}</p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Fechar" className="rounded-full px-3 py-1 text-xl text-muted">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {empty ? (
            <p className="px-5 py-12 text-center text-muted">Seu carrinho está vazio.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {cart.state.lines.map((line) => (
                  <li key={line.key} className="flex gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{line.name}</p>
                      {line.optionLabels.length > 0 && <p className="text-sm text-muted">{line.optionLabels.join(", ")}</p>}
                      {line.notes && <p className="text-sm text-muted italic">“{line.notes}”</p>}
                      <p className="mt-1 text-sm font-semibold">{formatBRL(line.unitPriceCents * line.quantity)}</p>
                    </div>
                    <div className="flex h-9 items-center self-center rounded-lg border border-border-strong">
                      <button
                        type="button"
                        aria-label={line.quantity === 1 ? `Remover ${line.name}` : "Diminuir"}
                        className="px-3 text-lg"
                        onClick={() => cart.setQuantity(line.key, line.quantity - 1)}
                      >
                        {line.quantity === 1 ? "🗑" : "−"}
                      </button>
                      <span className="w-5 text-center text-sm font-medium">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label="Aumentar"
                        className="px-3 text-lg"
                        onClick={() => cart.setQuantity(line.key, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Seu nome (opcional)
                  <input
                    value={cart.state.customerName}
                    onChange={(e) => cart.setField("customerName", e.target.value)}
                    maxLength={60}
                    autoComplete="given-name"
                    style={{ borderRadius: "var(--radius)" }}
                    className="h-11 border border-input-border bg-input px-3 text-base font-normal outline-none focus:border-brand"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Observações do pedido (opcional)
                  <textarea
                    value={cart.state.notes}
                    onChange={(e) => cart.setField("notes", e.target.value)}
                    maxLength={280}
                    rows={2}
                    style={{ borderRadius: "var(--radius)" }}
                    className="border border-input-border bg-input px-3 py-2 text-base font-normal outline-none focus:border-brand"
                  />
                </label>
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
                  Pagamento no local, ao final do atendimento.
                </p>
              </div>
            </>
          )}
        </div>

        {!empty && (
          <div className="flex flex-col gap-3 border-t border-border p-4">
            {error && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Total estimado</span>
              <span className="text-lg font-semibold">{formatBRL(cart.totalCents)}</span>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              style={{ borderRadius: "var(--radius)" }}
              className="h-12 bg-brand font-semibold text-brand-contrast disabled:opacity-60"
            >
              {sending ? "Enviando…" : "Enviar pedido"}
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
