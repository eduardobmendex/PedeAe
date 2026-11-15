"use client";

import { useEffect, useState, useTransition } from "react";
import { callService } from "@/app/q/[token]/actions";
import { formatBRL } from "@/lib/money";
import { BellIcon, ReceiptIcon } from "./menu-icons";

type Kind = "waiter" | "bill";
const COOLDOWN_MS = 30_000;

/** Chamar garçom e pedir a conta pela mesa. Avisa o painel da equipe na hora. */
export function ServiceButtons({ tableToken, tableName }: { tableToken: string; tableName: string }) {
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
