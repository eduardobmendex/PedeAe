import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db, type TestUser } from "./helpers";

type Report = {
  totals: { orders: number; revenue_cents: number; avg_ticket_cents: number; items_sold: number };
  cancelled: { orders: number; value_cents: number };
  by_day: { day: string; orders: number; revenue_cents: number }[];
  by_hour: { hour: number; orders: number; revenue_cents: number }[];
  top_products: { name: string; quantity: number; revenue_cents: number }[];
  by_table: { name: string; orders: number; revenue_cents: number }[];
};

/** Estabelecimento com uma mesa e dois produtos simples. */
async function seed(db: Db, admin: TestUser) {
  const orgId = await db.createOrg(admin, "Relatorios");
  await db.as(admin);
  const [cat] = await db.query<{ id: string }>("insert into categories (organization_id, name) values ($1, 'Lanches') returning id", [orgId]);
  const [burger] = await db.query<{ id: string }>(
    "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'Burger', 2500) returning id",
    [orgId, cat.id],
  );
  const [soda] = await db.query<{ id: string }>(
    "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'Refri', 600) returning id",
    [orgId, cat.id],
  );
  const [table] = await db.query<{ id: string }>("insert into tables (organization_id, name) values ($1, 'Mesa 4') returning id", [orgId]);
  const [{ token }] = await db.query<{ token: string }>("select token from table_qr_codes where table_id = $1", [table.id]);
  return { orgId, token, burgerId: burger.id, sodaId: soda.id };
}

async function order(db: Db, token: string, items: { product_id: string; quantity: number }[]) {
  await db.as(null);
  const [{ r }] = await db.query<{ r: { order_id: string } }>("select public.create_customer_order($1, $2, null, null, $3) as r", [
    token,
    JSON.stringify(items.map((i) => ({ ...i, options: [] }))),
    randomUUID(),
  ]);
  return r.order_id;
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());

describe("relatórios de vendas", () => {
  it("soma só pedidos aceitos, separa cancelados e agrupa por dia, hora, produto e mesa", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);

      await order(db, s.token, [{ product_id: s.burgerId, quantity: 2 }]); // 5000
      await order(db, s.token, [{ product_id: s.burgerId, quantity: 1 }, { product_id: s.sodaId, quantity: 3 }]); // 4300
      const cancelled = await order(db, s.token, [{ product_id: s.sodaId, quantity: 1 }]); // 600
      await db.as(ana);
      await db.query("select public.update_order_status($1, 'cancelled', null)", [cancelled]);

      const [{ r }] = await db.query<{ r: Report }>("select public.report_sales($1, $2, $2) as r", [s.orgId, today()]);
      expect(r.totals).toEqual({ orders: 2, revenue_cents: 9300, avg_ticket_cents: 4650, items_sold: 6 });
      expect(r.cancelled).toEqual({ orders: 1, value_cents: 600 });
      expect(r.by_day).toEqual([{ day: today(), orders: 2, revenue_cents: 9300 }]);
      expect(r.by_hour).toHaveLength(24);
      expect(r.by_hour.reduce((n, h) => n + h.orders, 0)).toBe(2);
      expect(r.top_products[0]).toEqual({ name: "Burger", quantity: 3, revenue_cents: 7500 });
      expect(r.by_table).toEqual([{ name: "Mesa 4", orders: 2, revenue_cents: 9300, avg_ticket_cents: 4650 }]);
    }));

  it("período vazio vem zerado com todos os dias; funcionário não vê; período inválido é recusado", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const s = await seed(db, ana);

      const [{ r }] = await db.query<{ r: Report }>("select public.report_sales($1, '2026-01-01', '2026-01-07') as r", [s.orgId]);
      expect(r.totals.orders).toBe(0);
      expect(r.by_day).toHaveLength(7);
      expect(r.top_products).toEqual([]);

      expect(await db.expectError("select public.report_sales($1, '2026-02-01', '2026-01-01')", [s.orgId])).toMatch(/invalid_range/);
      expect(await db.expectError("select public.report_sales($1, '2024-01-01', '2026-01-01')", [s.orgId])).toMatch(/invalid_range/);

      await db.as(await db.getPlatformAdmin());
      await db.query("select public.platform_create_member($1, $2, '', '', 'staff')", [s.orgId, carla.email]);
      await db.as(carla);
      expect(await db.expectError("select public.report_sales($1, '2026-01-01', '2026-01-07')", [s.orgId])).toMatch(/forbidden/);
    }));
});

describe("cobrança do SaaS", () => {
  it("estabelecimento nasce em teste; só o Admin Geral vê e altera plano e pagamentos", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgId = await db.createOrg(ana, "Cliente");

      // Admin do estabelecimento não enxerga a cobrança nem altera.
      await db.as(ana);
      expect(await db.query("select * from organization_billing where organization_id = $1", [orgId])).toEqual([]);
      expect(await db.expectError("select public.platform_set_billing($1, 'basico', 9900, 10, null, null)", [orgId])).toMatch(/forbidden/);
      expect(await db.expectError("select public.platform_overview()")).toMatch(/forbidden/);

      await db.as(await db.getPlatformAdmin());
      const [billing] = await db.query<{ plan: string; trial_ends_at: Date }>(
        "select plan, trial_ends_at from organization_billing where organization_id = $1",
        [orgId],
      );
      expect(billing.plan).toBe("trial");
      expect(billing.trial_ends_at).not.toBeNull();

      await db.query("select public.platform_set_billing($1, 'profissional', 19900, 5, null, 'cliente piloto')", [orgId]);
      await db.query("select public.platform_record_payment($1, '2026-11-17', 19900, '2026-11-05', 'pix', null)", [orgId]);
      const payments = await db.query<{ reference_month: Date }>(
        "select reference_month from billing_payments where organization_id = $1",
        [orgId],
      );
      expect(payments).toHaveLength(1);
      expect(payments[0].reference_month.getDate()).toBe(1); // mês de referência normalizado para o dia 1
      expect(await db.expectError("select public.platform_record_payment($1, '2026-11-01', 19900, null, 'pix', null)", [orgId])).toMatch(
        /payment_exists/,
      );
      expect(await db.expectError("select public.platform_set_billing($1, 'ouro', 1, 10, null, null)", [orgId])).toMatch(/check/);

      const [{ r }] = await db.query<{ r: { organization_id: string; members: number }[] }>("select public.platform_overview() as r");
      expect(r.find((o) => o.organization_id === orgId)?.members).toBe(1);

      const [{ n }] = await db.query<{ n: string }>(
        "select count(*) as n from audit_logs where organization_id = $1 and action like 'billing.%'",
        [orgId],
      );
      expect(Number(n)).toBe(2);
    }));
});
