"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState, useTransition } from "react";
import { Button, Card } from "@/components/ui";
import { centsToInput, formatBRL, parseBRL } from "@/lib/money";
import type { LinkResult } from "../actions";

/** Link de pagamento online da conta (Pix ou cartão), para mandar por WhatsApp ou mostrar o QR. */
export function PaymentLink({ suggestedCents, create }: { suggestedCents: number; create: (cents: number) => Promise<LinkResult> }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [link, setLink] = useState<{ url: string; cents: number; qr: string } | null>(null);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  // Com link aberto, a conta se atualiza sozinha quando o cliente paga.
  useEffect(() => {
    if (!link) return;
    const id = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(id);
  }, [link, router]);

  function generate() {
    const cents = amount.trim() ? parseBRL(amount) : suggestedCents;
    if (cents === null || cents < 100) return setError("Valor mínimo: R$ 1,00.");
    setError(undefined);
    start(async () => {
      const r = await create(cents).catch(() => ({ ok: false as const, error: "Sem conexão." }));
      if (!r.ok) return setError(r.error);
      const qr = await QRCode.toDataURL(r.url, { margin: 1, width: 220 });
      setLink({ url: r.url, cents, qr });
    });
  }

  const share = link ? `Olá! Segue o link para pagar ${formatBRL(link.cents)} com Pix ou cartão: ${link.url}` : "";

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold">Pagamento online</h2>
      {!link ? (
        <>
          <p className="text-sm text-muted">Gere um link (vale 24 h) para o cliente pagar com Pix ou cartão pelo celular, inclusive de longe.</p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Valor (R$)
            <input
              inputMode="decimal"
              value={amount}
              placeholder={centsToInput(suggestedCents)}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 rounded-lg border border-input-border bg-input px-3 text-base"
            />
          </label>
          <Button type="button" variant="secondary" onClick={generate} disabled={pending}>
            {pending ? "Gerando…" : "Gerar link de pagamento"}
          </Button>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link.qr} alt="QR Code do link de pagamento" className="size-44 rounded-lg bg-white p-2" />
          <p className="text-sm">
            {formatBRL(link.cents)} · o cliente pode escanear ou abrir o link.
          </p>
          <div className="flex w-full gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={async () => {
                await navigator.clipboard.writeText(link.url).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copiado!" : "Copiar link"}
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(share)}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-brand px-3 text-sm font-semibold text-brand-contrast"
            >
              WhatsApp
            </a>
          </div>
          <button type="button" onClick={() => setLink(null)} className="text-xs text-muted underline">
            Gerar outro
          </button>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Card>
  );
}
