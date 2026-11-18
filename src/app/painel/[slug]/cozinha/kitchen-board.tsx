"use client";

import { useEffect, useMemo, useState } from "react";
import type { OrderStatus } from "@/lib/orders";
import { StatusButton } from "../pedidos/order-card";
import { useAutoPrint } from "./auto-print";

export type KitchenOrder = {
  id: string;
  order_number: number;
  status: OrderStatus;
  customer_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  table_name: string | null;
  items: { id: string; name: string; quantity: number; notes: string | null; options: string[] }[];
};

const COLUMNS: { status: OrderStatus; title: string; next: OrderStatus; empty: string }[] = [
  { status: "received", title: "Na fila", next: "preparing", empty: "Nenhum pedido esperando." },
  { status: "preparing", title: "Em preparo", next: "ready", empty: "Nada no fogo agora." },
  { status: "ready", title: "Prontos", next: "delivered", empty: "Nenhum pedido aguardando entrega." },
];

// Tempo de espera: até 10 min normal, até 20 min atenção, depois atrasado.
const WARN_MIN = 10;
const LATE_MIN = 20;

/** Quadro da cozinha: três colunas, tickets grandes e tempo de espera atualizado a cada 30 s. */
export function KitchenBoard({ slug, orders }: { slug: string; orders: KitchenOrder[] }) {
  const now = useNow(30_000);
  const [tab, setTab] = useState<OrderStatus>("received");
  const queued = useMemo(() => orders.filter((o) => o.status === "received").map((o) => o.id), [orders]);
  useAutoPrint(slug, queued);

  return (
    <>
      {/* Celular: uma coluna por vez. */}
      <div role="tablist" aria-label="Etapas" className="grid grid-cols-3 gap-2 lg:hidden">
        {COLUMNS.map((c) => {
          const n = orders.filter((o) => o.status === c.status).length;
          return (
            <button
              key={c.status}
              role="tab"
              type="button"
              aria-selected={tab === c.status}
              onClick={() => setTab(c.status)}
              className={`rounded-lg px-2 py-2 text-sm font-semibold ${
                tab === c.status ? "bg-brand text-brand-contrast" : "bg-surface-2 text-muted"
              }`}
            >
              {c.title} ({n})
            </button>
          );
        })}
      </div>

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-3">
        {COLUMNS.map((c) => {
          const list = orders.filter((o) => o.status === c.status);
          return (
            <section
              key={c.status}
              aria-label={c.title}
              className={`flex flex-col gap-3 rounded-xl bg-surface-2 p-3 ${tab === c.status ? "" : "max-lg:hidden"}`}
            >
              <h2 className="flex items-center justify-between px-1 text-lg font-bold">
                {c.title}
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-sm">{list.length}</span>
              </h2>
              {list.length === 0 && <p className="px-1 py-8 text-center text-sm text-muted">{c.empty}</p>}
              {list.map((o) => (
                <Ticket key={o.id} slug={slug} order={o} next={c.next} now={now} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function Ticket({ slug, order, next, now }: { slug: string; order: KitchenOrder; next: OrderStatus; now: number }) {
  // Prontos contam desde que ficaram prontos; os demais, desde o pedido.
  const since = order.status === "ready" ? order.updated_at : order.created_at;
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  const late = order.status !== "ready" && minutes >= LATE_MIN;
  const warn = order.status !== "ready" && minutes >= WARN_MIN;

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border-2 bg-surface p-4 shadow-card ${
        late ? "border-danger" : warn ? "border-warning" : "border-border"
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-black">#{order.order_number}</p>
          <p className="font-semibold">
            {order.table_name ?? "Balcão"}
            {order.customer_name && <span className="font-normal text-muted"> · {order.customer_name}</span>}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${
            late ? "bg-danger-soft text-danger" : warn ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted"
          }`}
          title={new Date(since).toLocaleTimeString("pt-BR")}
        >
          {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`}
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {order.items.map((item) => (
          <li key={item.id} className="text-lg leading-snug">
            <span className="font-bold">{item.quantity}×</span> {item.name}
            {item.options.length > 0 && <span className="block text-base text-muted">{item.options.join(" · ")}</span>}
            {item.notes && <span className="block text-base font-semibold text-warning">⚠ {item.notes}</span>}
          </li>
        ))}
      </ul>
      {order.notes && <p className="rounded-lg bg-warning-soft px-3 py-2 font-medium text-warning">{order.notes}</p>}

      <div className="flex items-stretch gap-2">
        <div className="flex-1 [&_button]:h-12 [&_button]:w-full [&_button]:text-base [&_form]:w-full">
          <StatusButton slug={slug} orderId={order.id} to={next} />
        </div>
        <a
          href={`/imprimir/${slug}/pedido/${order.id}`}
          target="_blank"
          rel="noopener"
          aria-label={`Imprimir comanda do pedido ${order.order_number}`}
          title="Imprimir comanda"
          className="flex w-12 items-center justify-center rounded-lg border border-border-strong text-lg hover:bg-hover"
        >
          🖨
        </a>
      </div>
    </article>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
