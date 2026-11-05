import { describe, expect, it } from "vitest";
import { elapsedLabel, startOfBusinessDay, summarizeOrders } from "@/lib/order-metrics";
import type { OrderStatus } from "@/lib/orders";

const order = (status: OrderStatus, total_cents = 1000, created_at = "2026-11-04T15:00:00.000Z") => ({
  status,
  total_cents,
  created_at,
});

describe("indicadores de pedidos", () => {
  it("o dia começa à meia-noite da Bahia, não do servidor", () => {
    // 01:00 UTC do dia 5 ainda é 22:00 do dia 4 na Bahia.
    expect(startOfBusinessDay(new Date("2026-11-05T01:00:00Z"))).toBe("2026-11-04T03:00:00.000Z");
    expect(startOfBusinessDay(new Date("2026-11-05T03:00:00Z"))).toBe("2026-11-05T03:00:00.000Z");
  });

  it("separa a fila e não conta cancelados nas vendas", () => {
    const old = order("received", 500, "2026-11-03T20:00:00.000Z");
    const active = [old, order("pending_confirmation"), order("preparing"), order("ready")];
    const today = [
      order("pending_confirmation", 2000),
      order("preparing", 1000),
      order("delivered", 3000),
      order("cancelled", 9000),
      order("rejected", 9000),
    ];

    expect(summarizeOrders(active, today)).toEqual({
      queued: 2,
      preparing: 1,
      ready: 1,
      deliveredToday: 1,
      ordersToday: 5,
      lostToday: 2,
      salesTodayCents: 6000,
      averageTicketCents: 2000,
      oldestActiveAt: old.created_at,
    });
  });

  it("sem pedidos, tudo zerado e sem divisão por zero", () => {
    const m = summarizeOrders([], []);
    expect(m.averageTicketCents).toBe(0);
    expect(m.oldestActiveAt).toBeNull();
  });

  it("formata o tempo decorrido", () => {
    const now = new Date("2026-11-04T15:00:00Z").getTime();
    expect(elapsedLabel("2026-11-04T14:55:00Z", now)).toBe("há 5 min");
    expect(elapsedLabel("2026-11-04T13:40:00Z", now)).toBe("há 1h20");
  });
});
