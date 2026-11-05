import type { OrderStatus } from "./orders";

const BUSINESS_TIME_ZONE = "America/Bahia";

/** Início do dia na Bahia (sem horário de verão, UTC-3), independente do fuso do servidor. */
export function startOfBusinessDay(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

type MetricOrder = { status: OrderStatus; total_cents: number; created_at: string };

export type OrderMetrics = {
  queued: number;
  preparing: number;
  ready: number;
  deliveredToday: number;
  ordersToday: number;
  lostToday: number;
  salesTodayCents: number;
  averageTicketCents: number;
  /** Criação do pedido em andamento mais antigo. */
  oldestActiveAt: string | null;
};

/**
 * @param active pedidos em andamento, de qualquer dia (não podem sumir da fila)
 * @param today  todos os pedidos criados hoje
 */
export function summarizeOrders(active: MetricOrder[], today: MetricOrder[]): OrderMetrics {
  const count = (list: MetricOrder[], ...statuses: OrderStatus[]) => list.filter((o) => statuses.includes(o.status)).length;
  const sold = today.filter((o) => o.status !== "cancelled" && o.status !== "rejected");
  const salesTodayCents = sold.reduce((sum, o) => sum + o.total_cents, 0);

  return {
    queued: count(active, "pending_confirmation", "received"),
    preparing: count(active, "preparing"),
    ready: count(active, "ready"),
    deliveredToday: count(today, "delivered"),
    ordersToday: today.length,
    lostToday: count(today, "cancelled", "rejected"),
    salesTodayCents,
    averageTicketCents: sold.length ? Math.round(salesTodayCents / sold.length) : 0,
    oldestActiveAt: active.reduce<string | null>(
      (oldest, o) => (oldest === null || o.created_at < oldest ? o.created_at : oldest),
      null,
    ),
  };
}

/** "há 5 min", "há 1h20" */
export function elapsedLabel(iso: string, now = Date.now()) {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}
