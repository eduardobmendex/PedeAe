import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db, type TestUser } from "./helpers";

type Seed = { orgId: string; tableId: string; token: string; burgerId: string; sodaId: string };

async function seed(db: Db, admin: TestUser): Promise<Seed> {
  const orgId = await db.createOrg(admin, "Salao");
  await db.as(admin);
  const [cat] = await db.query<{ id: string }>("insert into categories (organization_id, name) values ($1, 'Lanches') returning id", [orgId]);
  const [burger] = await db.query<{ id: string }>(
    "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'Burger', 3000) returning id",
    [orgId, cat.id],
  );
  const [soda] = await db.query<{ id: string }>(
    "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'Refri', 1000) returning id",
    [orgId, cat.id],
  );
  const [table] = await db.query<{ id: string }>("insert into tables (organization_id, name) values ($1, 'Mesa 5') returning id", [orgId]);
  const [{ token }] = await db.query<{ token: string }>("select token from table_qr_codes where table_id = $1", [table.id]);
  return { orgId, tableId: table.id, token, burgerId: burger.id, sodaId: soda.id };
}

type OrderResult = { order_id: string; total_cents: number; discount_cents?: number };

async function order(db: Db, s: Seed, items: [string, number][], coupon: string | null = null) {
  await db.as(null);
  const [{ r }] = await db.query<{ r: OrderResult }>("select public.create_customer_order($1, $2, null, null, $3, $4) as r", [
    s.token,
    JSON.stringify(items.map(([product_id, quantity]) => ({ product_id, quantity, options: [] }))),
    randomUUID(),
    coupon,
  ]);
  return r;
}

async function member(db: Db, orgId: string, user: TestUser, role: "staff" | "supervisor") {
  await db.as(await db.getPlatformAdmin());
  await db.query("select public.platform_create_member($1, $2, '', '', $3)", [orgId, user.email, role]);
}

describe("esgotado", () => {
  it("equipe marca esgotado; cardápio mostra e o pedido é recusado", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const s = await seed(db, ana);
      await member(db, s.orgId, carla, "staff");

      await db.as(carla);
      await db.query("select public.set_product_sold_out($1, true)", [s.burgerId]);

      await db.as(ana);
      const [{ slug }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [s.orgId]);
      await db.query("update categories set active = true where organization_id = $1", [s.orgId]);
      await db.as(null);
      const [{ m }] = await db.query<{ m: { categories: { products: { name: string; sold_out: boolean }[] }[] } }>(
        "select public.get_public_menu($1) as m",
        [slug],
      );
      const products = m.categories[0].products;
      expect(products.find((p) => p.name === "Burger")?.sold_out).toBe(true);
      expect(products[products.length - 1].name).toBe("Burger"); // esgotados vão para o fim

      expect(
        await db.expectError("select public.create_customer_order($1, $2, null, null, $3)", [
          s.token,
          JSON.stringify([{ product_id: s.burgerId, quantity: 1, options: [] }]),
          randomUUID(),
        ]),
      ).toMatch(/product_sold_out/);
      expect(await db.expectError("select public.set_product_sold_out($1, false)", [s.burgerId])).toMatch(/permission denied/);
    }));
});

describe("cupons", () => {
  it("aplica percentual, respeita mínimo, validade e limite de usos (cancelar devolve o uso)", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      await db.as(ana);
      await db.query(
        `insert into coupons (organization_id, code, kind, value, min_order_cents, max_uses)
         values ($1, 'BEMVINDO', 'percent', 10, 2000, 1), ($1, 'VELHO', 'fixed', 500, 0, null)`,
        [s.orgId],
      );
      await db.query("update coupons set valid_until = current_date - 1 where code = 'VELHO' and organization_id = $1", [s.orgId]);

      // Prévia no carrinho.
      await db.as(null);
      const [{ c }] = await db.query<{ c: { discount_cents: number; coupon_id?: string } }>(
        "select public.check_coupon($1, 'bemvindo', 4000) as c",
        [s.token],
      );
      expect(c.discount_cents).toBe(400);
      expect(c.coupon_id).toBeUndefined();
      expect(await db.expectError("select public.check_coupon($1, 'BEMVINDO', 1500)", [s.token])).toMatch(/coupon_min_order/);
      expect(await db.expectError("select public.check_coupon($1, 'VELHO', 4000)", [s.token])).toMatch(/coupon_expired/);
      expect(await db.expectError("select public.check_coupon($1, 'NADA', 4000)", [s.token])).toMatch(/coupon_invalid/);

      const first = await order(db, s, [[s.burgerId, 1], [s.sodaId, 1]], " bemvindo ");
      expect(first.total_cents).toBe(3600);
      expect(first.discount_cents).toBe(400);
      expect(await db.expectError("select public.check_coupon($1, 'BEMVINDO', 4000)", [s.token])).toMatch(/coupon_exhausted/);

      // Cupom inválido desfaz o pedido inteiro.
      await db.as(ana);
      const [{ n: before }] = await db.query<{ n: string }>("select count(*) as n from orders where organization_id = $1", [s.orgId]);
      await db.as(null);
      expect(
        await db.expectError("select public.create_customer_order($1, $2, null, null, $3, 'NADA')", [
          s.token,
          JSON.stringify([{ product_id: s.sodaId, quantity: 1, options: [] }]),
          randomUUID(),
        ]),
      ).toMatch(/coupon_invalid/);
      await db.as(ana);
      const [{ n: after }] = await db.query<{ n: string }>("select count(*) as n from orders where organization_id = $1", [s.orgId]);
      expect(after).toBe(before);

      await db.query("select public.update_order_status($1, 'cancelled', null)", [first.order_id]);
      await db.as(null);
      const [{ c: again }] = await db.query<{ c: { discount_cents: number } }>("select public.check_coupon($1, 'BEMVINDO', 4000) as c", [s.token]);
      expect(again.discount_cents).toBe(400);
    }));

  it("só quem gerencia cupons cadastra; funcionário não aplica em pedido manual", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const s = await seed(db, ana);
      await member(db, s.orgId, carla, "staff");
      await db.as(ana);
      await db.query("insert into coupons (organization_id, code, kind, value) values ($1, 'DEZ', 'fixed', 1000)", [s.orgId]);

      await db.as(carla);
      expect(await db.expectError("insert into coupons (organization_id, code, kind, value) values ($1, 'X10', 'fixed', 1)", [s.orgId])).toMatch(
        /row-level security/,
      );
      const items = JSON.stringify([{ product_id: s.sodaId, quantity: 1, options: [] }]);
      expect(await db.expectError("select public.create_manual_order($1, null, $2, null, null, $3, 'DEZ')", [s.orgId, items, randomUUID()])).toMatch(
        /forbidden/,
      );
      await db.as(ana);
      const [{ r }] = await db.query<{ r: OrderResult }>("select public.create_manual_order($1, null, $2, null, null, $3, 'DEZ') as r", [
        s.orgId,
        items,
        randomUUID(),
      ]);
      expect(r.total_cents).toBe(0); // desconto fixo nunca passa do subtotal
    }));
});

describe("chamar garçom e pedir a conta", () => {
  it("não duplica chamado aberto, informa o total da mesa e a equipe resolve", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const s = await seed(db, ana);
      await member(db, s.orgId, carla, "staff");
      await order(db, s, [[s.burgerId, 2]]);

      await db.as(null);
      await db.query("select public.call_service($1, 'waiter')", [s.token]);
      await db.query("select public.call_service($1, 'waiter')", [s.token]);
      const [{ r }] = await db.query<{ r: { tab_total_cents: number } }>("select public.call_service($1, 'bill') as r", [s.token]);
      expect(r.tab_total_cents).toBe(6000);
      expect(await db.expectError("select * from service_calls")).toMatch(/permission denied/);

      await db.as(carla);
      const calls = await db.query<{ id: string; kind: string }>("select id, kind from service_calls where status = 'open' order by kind");
      expect(calls.map((c) => c.kind)).toEqual(["bill", "waiter"]);
      await db.query("select public.resolve_service_call($1)", [calls[0].id]);
      const [{ n }] = await db.query<{ n: string }>("select count(*) as n from service_calls where status = 'open'");
      expect(Number(n)).toBe(1);
    }));
});

describe("conta da mesa", () => {
  it("recebe em partes, exige tudo pago e entregue, fecha com taxa e libera a mesa", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const s = await seed(db, ana);
      await member(db, s.orgId, carla, "staff");
      const o1 = await order(db, s, [[s.burgerId, 1]]); // 3000
      const o2 = await order(db, s, [[s.sodaId, 2]]); // 2000

      await db.as(ana);
      const [{ id: sessionId }] = await db.query<{ id: string }>(
        "select id from table_sessions where table_id = $1 and status = 'open'",
        [s.tableId],
      );

      // Funcionário não recebe nem fecha (permissões desligadas por padrão).
      await db.as(carla);
      expect(await db.expectError("select public.record_tab_payment($1, 1000, 'pix')", [sessionId])).toMatch(/forbidden/);
      expect(await db.expectError("select public.close_tab($1, 10)", [sessionId])).toMatch(/forbidden/);

      await db.as(ana);
      expect(await db.expectError("select public.close_tab($1, 10)", [sessionId])).toMatch(/tab_has_active_orders/);
      for (const o of [o1, o2]) {
        await db.query("select public.update_order_status($1, 'preparing', null)", [o.order_id]);
        await db.query("select public.update_order_status($1, 'ready', null)", [o.order_id]);
        await db.query("select public.update_order_status($1, 'delivered', null)", [o.order_id]);
      }

      await db.query("select public.record_tab_payment($1, 3000, 'pix')", [sessionId]);
      // 5000 + 10% = 5500; pago 3000 → faltam 2500.
      expect(await db.expectError("select public.close_tab($1, 10)", [sessionId])).toMatch(/tab_not_paid/);
      await db.query("select public.record_tab_payment($1, 3000, 'dinheiro')", [sessionId]);

      const [{ t }] = await db.query<{ t: Record<string, number> }>("select public.close_tab($1, 10) as t", [sessionId]);
      expect(t).toEqual({ subtotal_cents: 5000, service_fee_cents: 500, total_cents: 5500, paid_cents: 6000 });

      const paid = await db.query<{ payment_status: string }>("select payment_status from orders where table_session_id = $1", [sessionId]);
      expect(paid.every((p) => p.payment_status === "paid")).toBe(true);
      expect(await db.expectError("select public.record_tab_payment($1, 100, 'pix')", [sessionId])).toMatch(/tab_closed/);

      // Próximo pedido abre uma conta nova.
      await order(db, s, [[s.sodaId, 1]]);
      await db.as(ana);
      const sessions = await db.query<{ status: string }>("select status from table_sessions where table_id = $1 order by opened_at", [s.tableId]);
      expect(sessions.map((x) => x.status)).toEqual(["closed", "open"]);
    }));
});
