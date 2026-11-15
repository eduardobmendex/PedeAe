"use client";

import { useActionState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { elapsedLabel } from "@/lib/order-metrics";
import { actionLabels, nextStatuses, orderStatusLabels, orderStatusTone, type OrderStatus } from "@/lib/orders";
import { updateOrderStatus } from "./actions";

export type PanelOrder = {
  id: string;
  order_number: number;
  status: OrderStatus;
  source: "customer" | "staff";
  customer_name: string | null;
  notes: string | null;
  total_cents: number;
  created_at: string;
  table_name: string | null;
  items: { id: string; name: string; quantity: number; notes: string | null; options: string[] }[];
};

export function OrderCard({ slug, order, canCancel }: { slug: string; order: PanelOrder; canCancel: boolean }) {
  const actions = nextStatuses[order.status].filter((s) => s !== "cancelled" || canCancel);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">#{order.order_number}</p>
          <p className="text-sm text-muted">
            {order.table_name ?? "Sem mesa"}
            {order.customer_name && ` · ${order.customer_name}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={orderStatusTone[order.status]}>{orderStatusLabels[order.status]}</Badge>
          <span className="text-xs text-muted" title={new Date(order.created_at).toLocaleString("pt-BR")}>
            {elapsedLabel(order.created_at)} ·{order.source === "staff" ? "equipe" : "cliente"}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        {order.items.map((item) => (
          <li key={item.id}>
            <span className="font-medium">
              {item.quantity}× {item.name}
            </span>
            {item.options.length > 0 && <span className="block text-muted">{item.options.join(", ")}</span>}
            {item.notes && <span className="block font-medium text-warning">⚠ {item.notes}</span>}
          </li>
        ))}
      </ul>
      {order.notes && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{order.notes}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="flex items-center gap-2">
          <span className="font-semibold">{formatBRL(order.total_cents)}</span>
          <a
            href={`/imprimir/${slug}/pedido/${order.id}`}
            target="_blank"
            rel="noopener"
            className="text-xs font-medium text-muted hover:text-text hover:underline"
          >
            Imprimir
          </a>
        </span>
        <div className="flex flex-wrap gap-2">
          {actions.map((to) => (
            <StatusButton key={to} slug={slug} orderId={order.id} to={to} />
          ))}
        </div>
      </div>
    </Card>
  );
}

export function StatusButton({ slug, orderId, to }: { slug: string; orderId: string; to: OrderStatus }) {
  const [state, action, pending] = useActionState(updateOrderStatus.bind(null, slug, orderId, to), undefined);
  const destructive = to === "cancelled" || to === "rejected";

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (destructive && !window.confirm(`${actionLabels[to]} este pedido?`)) e.preventDefault();
      }}
    >
      <Button type="submit" variant={destructive ? "danger" : "primary"} disabled={pending} className="h-9 px-3">
        {pending ? "…" : actionLabels[to]}
      </Button>
      {state?.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
    </form>
  );
}
