"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui";
import { centsToInput, formatBRL, parseBRL } from "@/lib/money";
import { cashPayment, computeTab, MAX_SERVICE_FEE, paymentMethods, splitEvenly, type TabPaymentMethod } from "@/lib/tab";
import { closeTab, recordPayment, removePayment } from "../actions";

type Payment = { id: string; amount_cents: number; method: string; created_at: string };

const time = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit" });

export function TabPanel({
  slug,
  sessionId,
  isOpen,
  activeOrders,
  orderTotals,
  payments,
  initialFee,
  canReceive,
  canClose,
}: {
  slug: string;
  sessionId: string;
  isOpen: boolean;
  activeOrders: number;
  orderTotals: number[];
  payments: Payment[];
  initialFee: number;
  canReceive: boolean;
  canClose: boolean;
}) {
  const router = useRouter();
  const [fee, setFee] = useState(initialFee);
  const [people, setPeople] = useState(1);
  const [method, setMethod] = useState<TabPaymentMethod>("pix");
  const t = computeTab(orderTotals, payments.map((p) => p.amount_cents), fee);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [closed, setClosed] = useState(false);

  const shares = splitEvenly(t.remainingCents, people);
  const typed = amount.trim() ? parseBRL(amount) : t.remainingCents;
  const cash = method === "dinheiro" && typed !== null ? cashPayment(typed, t.remainingCents) : null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(null);
    start(async () => {
      const r = await action().catch(() => ({ ok: false, error: "Sem conexão com o servidor." }));
      if (!r.ok) setMessage({ tone: "error", text: r.error ?? "Erro." });
      else {
        setMessage({ tone: "ok", text: success });
        setAmount("");
        router.refresh();
      }
    });
  }

  function receive() {
    if (typed === null || typed <= 0) {
      setMessage({ tone: "error", text: "Informe um valor válido." });
      return;
    }
    const applied = cash ? cash.appliedCents : typed;
    if (applied <= 0) {
      setMessage({ tone: "error", text: "Nada a receber." });
      return;
    }
    const change = cash?.changeCents ?? 0;
    run(
      () => recordPayment(slug, sessionId, applied, method),
      change > 0 ? `Recebido ${formatBRL(applied)}. Troco: ${formatBRL(change)}.` : `Recebido ${formatBRL(applied)}.`,
    );
  }

  const closeBlock = activeOrders > 0 ? `${activeOrders} pedido(s) ainda em andamento.` : t.remainingCents > 0 ? `Falta receber ${formatBRL(t.remainingCents)}.` : null;

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Resumo</h2>
        <Row label="Consumo" value={formatBRL(t.subtotalCents)} />
        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" checked={fee > 0} disabled={!isOpen} onChange={(e) => setFee(e.target.checked ? 10 : 0)} />
            Taxa de serviço
            {fee > 0 && isOpen && (
              <input
                type="number"
                min={0}
                max={MAX_SERVICE_FEE}
                step={1}
                value={fee}
                onChange={(e) => setFee(Math.max(0, Math.min(MAX_SERVICE_FEE, Number(e.target.value) || 0)))}
                aria-label="Percentual da taxa de serviço"
                className="h-7 w-14 rounded border border-input-border bg-input px-1 text-right text-text"
              />
            )}
            {fee > 0 && "%"}
          </label>
          <span className="tabular-nums">{formatBRL(t.serviceFeeCents)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 text-lg font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatBRL(t.totalCents)}</span>
        </div>
        {t.paidCents > 0 && <Row label="Recebido" value={formatBRL(t.paidCents)} tone="success" />}
        {isOpen && (
          <div className="flex items-center justify-between font-semibold">
            <span>{t.remainingCents > 0 ? "Falta receber" : "Conta paga"}</span>
            <span className={`tabular-nums ${t.remainingCents > 0 ? "text-danger" : "text-success"}`}>{formatBRL(t.remainingCents)}</span>
          </div>
        )}

        {isOpen && t.remainingCents > 0 && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <label className="flex items-center justify-between gap-2">
              Dividir por
              <span className="flex items-center gap-2">
                <button type="button" aria-label="Menos pessoas" onClick={() => setPeople((n) => Math.max(1, n - 1))} className="size-7 rounded border border-border-strong">
                  −
                </button>
                <span className="w-6 text-center font-semibold">{people}</span>
                <button type="button" aria-label="Mais pessoas" onClick={() => setPeople((n) => Math.min(50, n + 1))} className="size-7 rounded border border-border-strong">
                  +
                </button>
                pessoa(s)
              </span>
            </label>
            {people > 1 && (
              <p className="mt-2 text-muted">
                {shares[0] === shares[shares.length - 1]
                  ? `${formatBRL(shares[0])} por pessoa`
                  : `${formatBRL(shares[shares.length - 1])} por pessoa (${shares.filter((s) => s !== shares[shares.length - 1]).length} pagam ${formatBRL(shares[0])})`}
              </p>
            )}
          </div>
        )}
      </Card>

      {isOpen && canReceive && t.remainingCents > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Receber</h2>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pagamento">
            {(Object.keys(paymentMethods) as TabPaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={`rounded-lg border px-2 py-2 text-sm font-medium ${method === m ? "border-brand bg-active text-active-text" : "border-border-strong hover:bg-hover"}`}
              >
                {paymentMethods[m]}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {method === "dinheiro" ? "Valor entregue pelo cliente (R$)" : "Valor (R$)"}
            <input
              inputMode="decimal"
              value={amount}
              placeholder={centsToInput(people > 1 ? shares[0] : t.remainingCents)}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 rounded-lg border border-input-border bg-input px-3 text-base"
            />
            <span className="text-xs font-normal text-muted">Em branco = {people > 1 ? "a parte de uma pessoa" : "o valor que falta"}.</span>
          </label>
          {people > 1 && !amount.trim() && <p className="sr-only">Valor sugerido: {formatBRL(shares[0])}</p>}
          {cash && cash.changeCents > 0 && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">Troco: {formatBRL(cash.changeCents)}</p>
          )}
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!amount.trim() && people > 1) setAmount(centsToInput(shares[0]));
              else receive();
            }}
          >
            {pending ? "Registrando…" : !amount.trim() && people > 1 ? `Preencher ${formatBRL(shares[0])}` : "Registrar pagamento"}
          </Button>
        </Card>
      )}

      {payments.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">Pagamentos</h2>
          <ul className="divide-y divide-border text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  {paymentMethods[p.method as TabPaymentMethod] ?? p.method}
                  <span className="text-muted"> · {time.format(new Date(p.created_at))}</span>
                </span>
                <span className="font-semibold tabular-nums">{formatBRL(p.amount_cents)}</span>
                {isOpen && canReceive && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => window.confirm("Excluir este pagamento?") && run(() => removePayment(slug, sessionId, p.id), "Pagamento excluído.")}
                    className="text-xs text-danger hover:underline"
                  >
                    Excluir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {message && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.tone === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
          {message.text}
        </p>
      )}

      {isOpen && canClose && (
        <Card className="flex flex-col gap-2">
          <Button
            type="button"
            disabled={pending || closeBlock !== null}
            onClick={() =>
              run(async () => {
                const r = await closeTab(slug, sessionId, fee);
                if (r.ok) setClosed(true);
                return r;
              }, "Conta fechada. A mesa está livre.")
            }
          >
            Fechar conta e liberar a mesa
          </Button>
          <p className="text-xs text-muted">{closeBlock ?? "Tudo pago. Pode fechar a conta."}</p>
        </Card>
      )}
      {(closed || !isOpen) && (
        <a
          href={`/imprimir/${slug}/conta/${sessionId}`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 font-semibold text-brand-contrast"
        >
          Imprimir cupom
        </a>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className={`flex items-center justify-between text-sm ${tone === "success" ? "text-success" : "text-muted"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
