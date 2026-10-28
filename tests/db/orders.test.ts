import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db, type TestUser } from "./helpers";

type Seed = {
  orgId: string;
  tableId: string;
  token: string;
  burgerId: string;
  sizeOptionId: string;
  mediumId: string;
  largeId: string;
  extraOptionId: string;
  baconId: string;
  sodaId: string;
};

/** Estabelecimento com mesa, hambúrguer (tamanho obrigatório + extras) e refrigerante. */
async function seed(db: Db, admin: TestUser, name = "Hamburgueria"): Promise<Seed> {
  const orgId = await db.createOrg(admin, name);
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
  await db.query("select public.save_product_options($1, $2)", [
    burger.id,
    JSON.stringify([
      { name: "Tamanho", min_select: 1, max_select: 1, items: [{ name: "Médio" }, { name: "Grande", price_delta_cents: 700 }] },
      { name: "Extras", min_select: 0, max_select: 2, items: [{ name: "Bacon", price_delta_cents: 400 }, { name: "Ovo", price_delta_cents: 200 }] },
    ]),
  ]);
  const opts = await db.query<{ option_id: string; option: string; item_id: string; item: string }>(
    `select o.id as option_id, o.name as option, i.id as item_id, i.name as item
     from product_options o join product_option_items i on i.option_id = o.id where o.product_id = $1`,
    [burger.id],
  );
  const find = (item: string) => opts.find((o) => o.item === item)!;
  const [table] = await db.query<{ id: string }>("insert into tables (organization_id, name) values ($1, 'Mesa 1') returning id", [orgId]);
  const [{ token }] = await db.query<{ token: string }>(
    "select token from table_qr_codes where table_id = $1 and revoked_at is null",
    [table.id],
  );
  return {
    orgId,
    tableId: table.id,
    token,
    burgerId: burger.id,
    sizeOptionId: find("Médio").option_id,
    mediumId: find("Médio").item_id,
    largeId: find("Grande").item_id,
    extraOptionId: find("Bacon").option_id,
    baconId: find("Bacon").item_id,
    sodaId: soda.id,
  };
}

type OrderResult = { order_id: string; order_number: number; public_token: string; status: string; total_cents: number; duplicate: boolean };

async function customerOrder(db: Db, token: string, items: unknown[], key = randomUUID()) {
  await db.as(null);
  const [{ r }] = await db.query<{ r: OrderResult }>("select public.create_customer_order($1, $2, 'Ana', null, $3) as r", [
    token,
    JSON.stringify(items),
    key,
  ]);
  return r;
}

const burgerLarge = (s: Seed, extras: string[] = []) => ({
  product_id: s.burgerId,
  quantity: 2,
  notes: "sem cebola",
  options: [
    { option_id: s.sizeOptionId, item_ids: [s.largeId] },
    { option_id: s.extraOptionId, item_ids: extras },
  ],
});

describe("criação de pedidos", () => {
  it("o servidor calcula o total; snapshots preservam o histórico", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);

      const order = await customerOrder(db, s.token, [burgerLarge(s, [s.baconId]), { product_id: s.sodaId, quantity: 1 }]);
      // (2500 + 700 + 400) * 2 + 600
      expect(order.total_cents).toBe(7800);
      expect(order.status).toBe("received");
      expect(order.order_number).toBe(1);

      // Mudança de preço/nome no cardápio não altera o pedido.
      await db.as(ana);
      await db.query("update products set price_cents = 9999, name = 'Burger Novo' where id = $1", [s.burgerId]);
      const [item] = await db.query<{ product_name_snapshot: string; unit_price_cents: string; notes: string }>(
        "select product_name_snapshot, unit_price_cents, notes from order_items where order_id = $1 and product_id = $2",
        [order.order_id, s.burgerId],
      );
      expect(item).toEqual({ product_name_snapshot: "Burger", unit_price_cents: "3600", notes: "sem cebola" });
      const opts = await db.query<{ item_name_snapshot: string }>(
        `select item_name_snapshot from order_item_options o join order_items i on i.id = o.order_item_id
         where i.order_id = $1 order by item_name_snapshot`,
        [order.order_id],
      );
      expect(opts.map((o) => o.item_name_snapshot)).toEqual(["Bacon", "Grande"]);
    }));

  it("a mesma chave de idempotência não duplica o pedido", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      const key = randomUUID();

      const first = await customerOrder(db, s.token, [{ product_id: s.sodaId, quantity: 1 }], key);
      const again = await customerOrder(db, s.token, [{ product_id: s.sodaId, quantity: 3 }], key);
      expect(again.order_id).toBe(first.order_id);
      expect(again.duplicate).toBe(true);

      await db.as(ana);
      expect(await db.query("select id from orders where organization_id = $1", [s.orgId])).toHaveLength(1);
    }));

  it("rejeita adicionais inválidos, produto indisponível e QR revogado", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      const order = (items: unknown[]) =>
        db.expectError("select public.create_customer_order($1, $2, null, null, $3)", [s.token, JSON.stringify(items), randomUUID()]);

      await db.as(null);
      // Tamanho obrigatório ausente
      expect(await order([{ product_id: s.burgerId, quantity: 1, options: [] }])).toMatch(/invalid_options/);
      // Dois tamanhos (máx. 1)
      expect(
        await order([{ product_id: s.burgerId, quantity: 1, options: [{ option_id: s.sizeOptionId, item_ids: [s.mediumId, s.largeId] }] }]),
      ).toMatch(/invalid_options/);
      // Item de outro grupo enviado como tamanho
      expect(
        await order([{ product_id: s.burgerId, quantity: 1, options: [{ option_id: s.sizeOptionId, item_ids: [s.baconId] }] }]),
      ).toMatch(/option_unavailable/);
      // Opção de outro produto
      expect(
        await order([{ product_id: s.sodaId, quantity: 1, options: [{ option_id: s.sizeOptionId, item_ids: [s.mediumId] }] }]),
      ).toMatch(/invalid_options/);
      expect(await order([{ product_id: s.sodaId, quantity: 0 }])).toMatch(/invalid_quantity/);
      expect(await order([])).toMatch(/empty_order/);

      await db.as(ana);
      await db.query("update products set available = false where id = $1", [s.sodaId]);
      await db.as(null);
      expect(await order([{ product_id: s.sodaId, quantity: 1 }])).toMatch(/product_unavailable/);

      await db.as(ana);
      await db.query("select public.rotate_table_qr($1)", [s.tableId]);
      await db.as(null);
      expect(await order([burgerLarge(s)])).toMatch(/table_invalid/);
    }));

  it("pedidos da mesma mesa compartilham a sessão; numeração é por estabelecimento", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const a = await seed(db, ana, "Loja A");
      const b = await seed(db, bruno, "Loja B");

      const o1 = await customerOrder(db, a.token, [{ product_id: a.sodaId, quantity: 1 }]);
      const o2 = await customerOrder(db, a.token, [{ product_id: a.sodaId, quantity: 1 }]);
      const ob = await customerOrder(db, b.token, [{ product_id: b.sodaId, quantity: 1 }]);
      expect([o1.order_number, o2.order_number, ob.order_number]).toEqual([1, 2, 1]);

      await db.as(ana);
      const sessions = await db.query<{ table_session_id: string }>(
        "select distinct table_session_id from orders where organization_id = $1",
        [a.orgId],
      );
      expect(sessions).toHaveLength(1);
      // Isolamento: Ana não enxerga pedidos da Loja B.
      expect(await db.query("select id from orders where organization_id = $1", [b.orgId])).toEqual([]);
    }));

  it("visitante não lê a tabela de pedidos, só o próprio pelo token", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      const order = await customerOrder(db, s.token, [burgerLarge(s)]);

      await db.as(null);
      expect(await db.expectError("select * from orders")).toMatch(/permission denied/);
      const [{ r }] = await db.query<{ r: { order_number: number; table_name: string; items: unknown[] } }>(
        "select public.get_order_by_token($1) as r",
        [order.public_token],
      );
      expect(r.order_number).toBe(order.order_number);
      expect(r.table_name).toBe("Mesa 1");
      expect(r.items).toHaveLength(1);
      const [{ r: none }] = await db.query<{ r: unknown }>("select public.get_order_by_token('x') as r");
      expect(none).toBeNull();
    }));

  it("confirmação obrigatória e limite de pedidos por mesa", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      await db.as(ana);
      await db.query(
        "update organization_settings set settings = settings || '{\"require_order_confirmation\": true}' where organization_id = $1",
        [s.orgId],
      );

      const first = await customerOrder(db, s.token, [{ product_id: s.sodaId, quantity: 1 }]);
      expect(first.status).toBe("pending_confirmation");
      for (let i = 0; i < 5; i++) await customerOrder(db, s.token, [{ product_id: s.sodaId, quantity: 1 }]);
      expect(
        await db.expectError("select public.create_customer_order($1, $2, null, null, $3)", [
          s.token,
          JSON.stringify([{ product_id: s.sodaId, quantity: 1 }]),
          randomUUID(),
        ]),
      ).toMatch(/rate_limited/);
    }));
});

describe("pedidos manuais e status", () => {
  it("funcionário lança pedido e avança status; cancelar exige permissão", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const s = await seed(db, ana);

      await db.as(ana);
      const [{ token }] = await db.query<{ token: string }>("select public.create_invitation($1, $2, 'staff') as token", [
        s.orgId,
        carla.email,
      ]);
      await db.as(carla);
      await db.query("select public.accept_invitation($1)", [token]);

      const [{ r: order }] = await db.query<{ r: OrderResult }>(
        "select public.create_manual_order($1, $2, $3, 'Balcão', null, $4) as r",
        [s.orgId, s.tableId, JSON.stringify([{ product_id: s.sodaId, quantity: 2 }]), randomUUID()],
      );
      expect(order.total_cents).toBe(1200);

      expect(await db.expectError("select public.update_order_status($1, 'delivered')", [order.order_id])).toMatch(
        /invalid_transition/,
      );
      await db.query("select public.update_order_status($1, 'preparing')", [order.order_id]);
      await db.query("select public.update_order_status($1, 'preparing')", [order.order_id]); // idempotente
      expect(await db.expectError("select public.update_order_status($1, 'cancelled')", [order.order_id])).toMatch(/forbidden/);

      await db.as(ana);
      await db.query("select public.update_order_status($1, 'cancelled', 'cliente desistiu')", [order.order_id]);
      const events = await db.query<{ to_status: string }>(
        "select to_status from order_events where order_id = $1 order by id",
        [order.order_id],
      );
      expect(events.map((e) => e.to_status)).toEqual(["received", "preparing", "cancelled"]);
      const audit = await db.query("select 1 from audit_logs where entity_id = $1 and action = 'order.cancelled'", [order.order_id]);
      expect(audit).toHaveLength(1);
    }));

  it("membro de outro estabelecimento não lança pedido nem altera status", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const s = await seed(db, ana);
      await db.createOrg(bruno, "Outra");
      const order = await customerOrder(db, s.token, [{ product_id: s.sodaId, quantity: 1 }]);

      await db.as(bruno);
      expect(
        await db.expectError("select public.create_manual_order($1, null, $2, null, null, $3)", [
          s.orgId,
          JSON.stringify([{ product_id: s.sodaId, quantity: 1 }]),
          randomUUID(),
        ]),
      ).toMatch(/forbidden/);
      expect(await db.expectError("select public.update_order_status($1, 'preparing')", [order.order_id])).toMatch(/forbidden/);
    }));
});
