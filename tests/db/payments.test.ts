import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db, type TestUser } from "./helpers";

type Seed = { orgId: string; slug: string; tableId: string; token: string; burgerId: string };

async function seed(db: Db, admin: TestUser): Promise<Seed> {
  const orgId = await db.createOrg(admin, "Pagamentos");
  await db.as(admin);
  const [{ slug }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [orgId]);
  const [cat] = await db.query<{ id: string }>("insert into categories (organization_id, name) values ($1, 'Lanches') returning id", [orgId]);
  const [burger] = await db.query<{ id: string }>(
    "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'Burger', 5000) returning id",
    [orgId, cat.id],
  );
  const [table] = await db.query<{ id: string }>("insert into tables (organization_id, name) values ($1, 'Mesa 2') returning id", [orgId]);
  const [{ token }] = await db.query<{ token: string }>("select token from table_qr_codes where table_id = $1", [table.id]);
  return { orgId, slug, tableId: table.id, token, burgerId: burger.id };
}

async function enableOnline(db: Db, orgId: string) {
  await db.as(await db.getPlatformAdmin());
  await db.query("select public.platform_set_payment_settings($1, true, 're_teste123', 5)", [orgId]);
  // KYC aprovado no Pagar.me (status consultado pela tela de recebedores).
  await db.query("select public.platform_sync_recipient($1, 're_teste123', 'active', 'approved', 'ok', 'corporation', 'Loja')", [orgId]);
}

async function order(db: Db, s: Seed, qty: number, prepay = false) {
  await db.as(null);
  const [{ r }] = await db.query<{ r: { order_id: string; status: string; total_cents: number; payment_token?: string } }>(
    "select public.create_customer_order($1, $2, null, null, $3, null, $4) as r",
    [s.token, JSON.stringify([{ product_id: s.burgerId, quantity: qty, options: [] }]), randomUUID(), prepay],
  );
  return r;
}

describe("esgotado só hoje", () => {
  it("vale no dia e volta sozinho no dia seguinte", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      await db.as(ana);
      await db.query("select public.set_product_sold_out($1, true)", [s.burgerId]); // padrão: só hoje

      const menu = async () => {
        await db.as(null);
        const [{ m }] = await db.query<{ m: { categories: { products: { sold_out: boolean }[] }[] } }>("select public.get_public_menu($1) as m", [s.slug]);
        return m.categories[0].products[0].sold_out;
      };
      expect(await menu()).toBe(true);

      // "Ontem": o esgotado venceu e o produto volta a ser vendido sem ninguém mexer.
      await db.asSuperuser();
      await db.query("update products set sold_out_until = current_date - 2 where id = $1", [s.burgerId]);
      expect(await menu()).toBe(false);
      const r = await order(db, s, 1);
      expect(r.status).toBe("received");

      // "Até reativar" não vence.
      await db.as(ana);
      await db.query("select public.set_product_sold_out($1, true, false)", [s.burgerId]);
      await db.asSuperuser();
      const [{ until }] = await db.query<{ until: string | null }>("select sold_out_until as until from products where id = $1", [s.burgerId]);
      expect(until).toBeNull();
    }));
});

describe("pagamento online", () => {
  it("desligado por padrão; Admin Geral liga com o recebedor do estabelecimento", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      await order(db, s, 1);
      await db.as(null);
      expect(await db.expectError("select public.create_tab_payment_intent($1, null, true)", [s.token])).toMatch(/online_payments_disabled/);

      await db.as(ana);
      expect(await db.expectError("select public.platform_set_payment_settings($1, true, 'rp_x1', 0)", [s.orgId])).toMatch(/forbidden/);
      await db.as(await db.getPlatformAdmin());
      expect(await db.expectError("select public.platform_set_payment_settings($1, true, null, 0)", [s.orgId])).toMatch(/check/);
      await db.query("select public.platform_set_payment_settings($1, true, 'rp_teste123', 5)", [s.orgId]);

      // Ligado, mas sem KYC aprovado: ainda não recebe.
      const menu = async () => {
        await db.as(null);
        const [{ m }] = await db.query<{ m: { online_payments: boolean } }>("select public.get_public_menu($1) as m", [s.slug]);
        return m.online_payments;
      };
      expect(await menu()).toBe(false);
      await db.as(await db.getPlatformAdmin());
      await db.query("select public.platform_sync_recipient($1, 'rp_teste123', 'active', 'approved', 'ok', null, null)", [s.orgId]);
      expect(await menu()).toBe(true);
    }));

  it("conta da mesa: paga a conta toda ou uma parte; confirmação só pelo servidor e sem duplicar", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      await enableOnline(db, s.orgId);
      await order(db, s, 2); // 10000

      await db.as(null);
      // Com 10% de serviço: 11000. Parte de 4000 e depois o resto.
      expect(await db.expectError("select public.create_tab_payment_intent($1, 20000, true)", [s.token])).toMatch(/invalid_amount/);
      const [{ r: part }] = await db.query<{ r: { token: string; amount_cents: number } }>(
        "select public.create_tab_payment_intent($1, 4000, true) as r",
        [s.token],
      );
      expect(part.amount_cents).toBe(4000);
      const [{ i }] = await db.query<{ i: { id: string; status: string; table_name: string; kind: string } }>(
        "select public.get_payment_intent($1) as i",
        [part.token],
      );
      expect(i).toMatchObject({ status: "pending", table_name: "Mesa 2", kind: "tab" });

      // Cliente não consegue se dar como pago.
      expect(await db.expectError("select public.confirm_payment_intent($1, 'pix', 'or_1', 4000)", [i.id])).toMatch(/permission denied/);

      await db.asService();
      expect(await db.expectError("select public.confirm_payment_intent($1, 'pix', 'or_1', 3999)", [i.id])).toMatch(/amount_mismatch/);
      await db.query("select public.confirm_payment_intent($1, 'pix', 'or_1', 4000)", [i.id]);
      const [{ r: again }] = await db.query<{ r: { duplicate: boolean } }>("select public.confirm_payment_intent($1, 'pix', 'or_1', 4000) as r", [i.id]);
      expect(again.duplicate).toBe(true);

      await db.as(ana);
      const pays = await db.query<{ amount_cents: string; method: string }>(
        "select amount_cents, method from tab_payments tp join table_sessions ts on ts.id = tp.table_session_id where ts.table_id = $1",
        [s.tableId],
      );
      expect(pays).toEqual([{ amount_cents: "4000", method: "pix" }]);

      // Restante: 11000 − 4000 = 7000.
      await db.as(null);
      const [{ r: rest }] = await db.query<{ r: { amount_cents: number } }>("select public.create_tab_payment_intent($1, null, true) as r", [s.token]);
      expect(rest.amount_cents).toBe(7000);
    }));

  it("pedido antecipado só vai para a fila depois de pago e entra pago na conta", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      await enableOnline(db, s.orgId);

      const r = await order(db, s, 1, true);
      expect(r.status).toBe("awaiting_payment");
      expect(r.payment_token).toMatch(/^[0-9a-f]{32}$/);

      await db.as(ana);
      const [{ status: before }] = await db.query<{ status: string }>("select status from orders where id = $1", [r.order_id]);
      expect(before).toBe("awaiting_payment");

      await db.as(null);
      const [{ i }] = await db.query<{ i: { id: string; amount_cents: number; order: { status: string } } }>(
        "select public.get_payment_intent($1) as i",
        [r.payment_token],
      );
      expect(i.amount_cents).toBe(5000);
      await db.asService();
      await db.query("select public.confirm_payment_intent($1, 'credit_card', 'or_2', 5000)", [i.id]);

      await db.as(ana);
      const [o] = await db.query<{ status: string; payment_status: string }>("select status, payment_status from orders where id = $1", [r.order_id]);
      expect(o).toEqual({ status: "received", payment_status: "paid" });
      const [{ method }] = await db.query<{ method: string }>("select method from tab_payments where payment_intent_id = $1", [i.id]);
      expect(method).toBe("credito");
    }));

  it("equipe gera link de pagamento para a conta", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const s = await seed(db, ana);
      await enableOnline(db, s.orgId);
      await db.query("select public.platform_create_member($1, $2, '', '', 'staff')", [s.orgId, carla.email]);
      await order(db, s, 1);
      await db.as(ana);
      const [{ id: sessionId }] = await db.query<{ id: string }>("select id from table_sessions where table_id = $1", [s.tableId]);

      await db.as(carla);
      expect(await db.expectError("select public.create_tab_payment_link($1, 5500)", [sessionId])).toMatch(/forbidden/);
      await db.as(ana);
      const [{ r }] = await db.query<{ r: { token: string } }>("select public.create_tab_payment_link($1, 5500) as r", [sessionId]);
      const [{ source }] = await db.query<{ source: string }>("select source from payment_intents where public_token = $1", [r.token]);
      expect(source).toBe("staff_link");
    }));
});

describe("recebimentos no relatório", () => {
  it("soma por forma de pagamento, por pessoa e a taxa de serviço das contas fechadas", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);
      const o = await order(db, s, 2); // 10000
      await db.as(ana);
      for (const to of ["preparing", "ready", "delivered"]) await db.query("select public.update_order_status($1, $2, null)", [o.order_id, to]);
      const [{ id: sessionId }] = await db.query<{ id: string }>("select id from table_sessions where table_id = $1", [s.tableId]);
      await db.query("select public.record_tab_payment($1, 6000, 'pix')", [sessionId]);
      await db.query("select public.record_tab_payment($1, 5000, 'dinheiro')", [sessionId]);
      await db.query("select public.close_tab($1, 10)", [sessionId]);

      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());
      const [{ r }] = await db.query<{
        r: { total_cents: number; by_method: { method: string; amount_cents: number }[]; by_person: { amount_cents: number }[]; service_fee_cents: number; tabs_closed: number };
      }>("select public.report_payments($1, $2, $2) as r", [s.orgId, today]);
      expect(r.total_cents).toBe(11000);
      expect(r.by_method).toEqual([
        { method: "pix", count: 1, amount_cents: 6000, online_cents: null },
        { method: "dinheiro", count: 1, amount_cents: 5000, online_cents: null },
      ]);
      expect(r.by_person).toHaveLength(1);
      expect(r.service_fee_cents).toBe(1000);
      expect(r.tabs_closed).toBe(1);
    }));
});

describe("recebedores e KYC", () => {
  it("status vem do Pagar.me: só Admin Geral vincula; webhook atualiza; bloqueado desliga o pagamento", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const s = await seed(db, ana);

      await db.as(ana);
      expect(await db.expectError("select public.platform_sync_recipient($1, 're_abc', 'active', 'approved', 'ok', null, null)", [s.orgId])).toMatch(/forbidden/);
      expect(await db.expectError("select public.service_sync_recipient('re_abc', 'active', 'approved', 'ok')")).toMatch(/permission denied/);

      const admin = await db.getPlatformAdmin();
      await db.as(admin);
      expect(await db.expectError("select public.platform_sync_recipient($1, 'acc_abc', 'active', null, null, null, null)", [s.orgId])).toMatch(/invalid_recipient/);
      // Iniciar KYC: recebedor criado, Pagar.me pede documentos.
      const [{ changed }] = await db.query<{ changed: boolean }>(
        "select public.platform_sync_recipient($1, 're_abc', 'affiliation', 'partially_denied', 'additional_documents_required', 'corporation', 'Loja') as changed",
        [s.orgId],
      );
      expect(changed).toBe(true);
      await db.query("select public.platform_set_payment_settings($1, true, 're_abc', 0)", [s.orgId]); // liga antes da aprovação
      await db.query("select public.platform_mark_kyc_link($1)", [s.orgId]);
      const online = async () => {
        await db.as(null);
        const [{ m }] = await db.query<{ m: { online_payments: boolean } }>("select public.get_public_menu($1) as m", [s.slug]);
        return m.online_payments;
      };
      expect(await online()).toBe(false);

      // Webhook recipient.updated (chave secreta do servidor): aprovado → começa a receber sozinho.
      await db.asService();
      const [{ slug }] = await db.query<{ slug: string | null }>("select public.service_sync_recipient('re_abc', 'active', 'approved', 'ok') as slug");
      expect(slug).toBe(s.slug);
      const [{ again }] = await db.query<{ again: string | null }>("select public.service_sync_recipient('re_abc', 'active', 'approved', 'ok') as again");
      expect(again).toBeNull(); // sem mudança
      const [{ other }] = await db.query<{ other: string | null }>("select public.service_sync_recipient('re_deoutro', 'active', null, null) as other");
      expect(other).toBeNull(); // recebedor que não é nosso
      expect(await online()).toBe(true);

      await db.asService();
      await db.query("select public.service_sync_recipient('re_abc', 'blocked', 'approved', 'ok')");
      expect(await online()).toBe(false);

      await db.as(admin);
      const [row] = await db.query<{ recipient_type: string; recipient_name: string; kyc_link_sent_at: string | null }>(
        "select recipient_type, recipient_name, kyc_link_sent_at from organization_payment_settings where organization_id = $1",
        [s.orgId],
      );
      expect(row).toMatchObject({ recipient_type: "corporation", recipient_name: "Loja" });
      expect(row.kyc_link_sent_at).not.toBeNull();
      const actions = await db.query<{ action: string }>(
        "select action from audit_logs where organization_id = $1 and action like 'payments.%' order by id",
        [s.orgId],
      );
      expect(actions.map((a) => a.action)).toEqual([
        "payments.recipient_status",
        "payments.settings_updated",
        "payments.kyc_link_created",
        "payments.recipient_status",
        "payments.recipient_status",
      ]);

      // Trocar o recebedor zera o status conhecido.
      await db.query("select public.platform_set_payment_settings($1, true, 're_novo', 0)", [s.orgId]);
      const [{ recipient_status }] = await db.query<{ recipient_status: string | null }>(
        "select recipient_status from organization_payment_settings where organization_id = $1",
        [s.orgId],
      );
      expect(recipient_status).toBeNull();
    }));

  it("slug 'recebedores' é reservado (rota do painel)", () =>
    withRollback(async (db) => {
      await db.as(await db.getPlatformAdmin());
      expect(await db.expectError("select public.platform_create_organization('Teste', 'recebedores')")).toMatch(/slug_not_reserved|check/);
    }));
});
