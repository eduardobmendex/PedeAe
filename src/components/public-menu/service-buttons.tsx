"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { callService, startTabPayment } from "@/app/q/[token]/actions";
import { formatBRL, parseBRL } from "@/lib/money";
import { BellIcon, ReceiptIcon } from "./menu-icons";

type Kind = "waiter" | "bill";
const COOLDOWN_MS = 30_000;

/** Chamar garçom e pedir a conta pela mesa. Avisa o painel da equipe na hora. */
export function ServiceButtons({ tableToken, tableName, onlinePayments = false }: { tableToken: string; tableName: string; onlinePayments?: boolean }) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [whole, setWhole] = useState(true);
  const [amount, setAmount] = useState("");
  const [withFee, setWithFee] = useState(true);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [cooling, setCooling] = useState<Kind | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!cooling) return;
    const id = setTimeout(() => setCooling(null), COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [cooling]);

  function call(kind: Kind) {
    setMessage(null);
    start(async () => {
      const r = await callService(tableToken, kind).catch(() => ({ ok: false as const, error: "Sem conexão. Tente de novo." }));
      if (!r.ok) {
        setMessage({ tone: "error", text: r.error });
        return;
      }
      setCooling(kind);
      setMessage({
        tone: "ok",
        text:
          kind === "waiter"
            ? `Garçom chamado! Já vamos até a ${tableName}.`
            : `Conta solicitada! ${r.tabTotalCents > 0 ? `Total até agora: ${formatBRL(r.tabTotalCents)}.` : ""} Já vamos até a ${tableName}.`,
      });
    });
  }

  function pay() {
    setMessage(null);
    const cents = whole ? null : parseBRL(amount);
    if (!whole && (cents === null || cents < 100)) {
      setMessage({ tone: "error", text: "Informe um valor a partir de R$ 1,00." });
      return;
    }
    start(async () => {
      const r = await startTabPayment(tableToken, cents, withFee).catch(() => ({ ok: false as const, error: "Sem conexão. Tente de novo." }));
      if (!r.ok) setMessage({ tone: "error", text: r.error });
      else router.push(`/pagar/${r.token}`);
    });
  }

  const button =
    "flex flex-1 items-center justify-center gap-2 border border-brand/40 bg-surface px-3 py-2.5 text-sm font-semibold text-text transition hover:border-brand disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2 px-4 pt-1 pb-2 sm:px-6">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => call("waiter")}
          disabled={pending || cooling === "waiter"}
          style={{ borderRadius: "calc(var(--radius) * 2)" }}
          className={button}
        >
          <BellIcon className="size-4.5 text-brand-text" />
          {cooling === "waiter" ? "Garçom chamado" : "Chamar garçom"}
        </button>
        <button
          type="button"
          onClick={() => call("bill")}
          disabled={pending || cooling === "bill"}
          style={{ borderRadius: "calc(var(--radius) * 2)" }}
          className={button}
        >
          <ReceiptIcon className="size-4.5 text-brand-text" />
          {cooling === "bill" ? "Conta pedida" : "Pedir a conta"}
        </button>
      </div>
      {onlinePayments && (
        <button
          type="button"
          onClick={() => setPayOpen((o) => !o)}
          aria-expanded={payOpen}
          style={{ borderRadius: "calc(var(--radius) * 2)" }}
          className="flex items-center justify-center gap-2 bg-brand px-3 py-2.5 text-sm font-semibold text-brand-contrast"
        >
          Pagar a conta pelo celular (Pix ou cartão)
        </button>
      )}
      {onlinePayments && payOpen && (
        <div style={{ borderRadius: "var(--radius)" }} className="flex flex-col gap-2 border border-border-strong bg-surface p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="pay-amount" checked={whole} onChange={() => setWhole(true)} />
            Pagar tudo o que falta na mesa
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="pay-amount" checked={!whole} onChange={() => setWhole(false)} />
            Pagar só a minha parte:
            <input
              inputMode="decimal"
              placeholder="R$ 0,00"
              value={amount}
              onFocus={() => setWhole(false)}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Valor da minha parte"
              className="h-9 w-28 rounded border border-input-border bg-input px-2 text-base"
            />
          </label>
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" checked={withFee} onChange={(e) => setWithFee(e.target.checked)} />
            Incluir 10% de serviço (opcional)
          </label>
          <button type="button" onClick={pay} disabled={pending} style={{ borderRadius: "var(--radius)" }} className="h-10 bg-brand font-semibold text-brand-contrast disabled:opacity-60">
            {pending ? "Abrindo…" : "Ir para o pagamento"}
          </button>
        </div>
      )}
      {message && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${message.tone === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
