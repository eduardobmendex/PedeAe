import { randomUUID } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Estabelecimento descartável para os testes de ponta a ponta:
 * mesa com QR Code, dois produtos e um usuário admin com senha conhecida.
 * Tudo é apagado ao final do teste, mesmo se ele falhar.
 */
export type Shop = {
  orgId: string;
  slug: string;
  tableToken: string;
  admin: { email: string; password: string };
};

const ORG_TABLES = [
  "service_calls", "tab_payments", "coupons", "billing_payments", "organization_billing", "order_item_options", "order_items", "order_events", "orders",
  "table_sessions", "order_counters", "table_qr_codes", "tables", "product_option_items", "product_options",
  "products", "categories", "invitations", "memberships", "audit_logs", "organization_settings",
];

async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida (veja .env)");
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const db = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  db.on("error", () => {}); // conexão ociosa derrubada pelo pooler não deve derrubar o teste
  await db.connect();
  return db;
}

async function createShop(): Promise<Shop & { userId: string }> {
  const db = await connect();
  try {
    await db.query("begin");
    const suffix = randomUUID().slice(0, 8);
    const slug = `e2e-${suffix}`;
    const admin = { email: `e2e-${suffix}@pedeae.test`, password: `Senha-${randomUUID()}` };

    const userId = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
         email_change_token_new, email_change)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
         extensions.crypt($3, extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', '{"name":"Admin E2E"}', now(), now(), '', '', '', '')`,
      [userId, admin.email, admin.password],
    );
    await db.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
       values ($3, $1, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true), 'email', now(), now())`,
      [userId, admin.email, userId],
    );

    const orgId = (await db.query("insert into organizations (name, slug) values ('Lanchonete E2E', $1) returning id", [slug])).rows[0].id;
    await db.query("insert into organization_settings (organization_id) values ($1) on conflict do nothing", [orgId]);
    await db.query("insert into memberships (organization_id, user_id, role, status) values ($1, $2, 'admin', 'active')", [orgId, userId]);
    const cat = (await db.query("insert into categories (organization_id, name, active) values ($1, 'Lanches', true) returning id", [orgId])).rows[0].id;
    await db.query(
      `insert into products (organization_id, category_id, name, description, price_cents)
       values ($1, $2, 'X-Teste', 'Pão, carne e queijo', 2500), ($1, $2, 'Suco E2E', 'Laranja', 900)`,
      [orgId, cat],
    );
    const table = (await db.query("insert into tables (organization_id, name) values ($1, 'Mesa 9') returning id", [orgId])).rows[0].id;
    const tableToken = (await db.query("select token from table_qr_codes where table_id = $1 and revoked_at is null", [table])).rows[0].token;

    await db.query("commit");
    return { orgId, slug, tableToken, admin, userId };
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

/** Acesso direto ao banco nos testes (ex.: criar um cupom). */
export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await connect();
  try {
    return (await db.query(text, values)).rows as T[];
  } finally {
    await db.end();
  }
}

async function removeShop(shop: { orgId: string; userId: string }) {
  const db = await connect();
  try {
    await db.query("begin");
    // Gatilhos desligados só nesta transação: a limpeza não gera auditoria nem esbarra em FKs restritivas.
    await db.query("set local session_replication_role = replica");
    for (const t of ORG_TABLES) await db.query(`delete from public.${t} where organization_id = $1`, [shop.orgId]);
    await db.query("delete from public.organizations where id = $1", [shop.orgId]);
    await db.query("delete from public.profiles where id = $1", [shop.userId]);
    await db.query("delete from auth.identities where user_id = $1", [shop.userId]);
    await db.query("delete from auth.users where id = $1", [shop.userId]);
    await db.query("commit");
  } finally {
    await db.end();
  }
}

export const test = base.extend<{ shop: Shop }>({
  shop: async ({}, use) => {
    const shop = await createShop();
    try {
      await use(shop);
    } finally {
      await removeShop(shop);
    }
  },
});

export { expect };

/**
 * Entra no painel e espera a lista de estabelecimentos carregar. Sem essa espera, uma
 * navegação logo em seguida cruza com o redirecionamento pós-login e fica pela metade.
 */
export async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill(user.password);
  await page.locator("form button[type=submit]", { hasText: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Meus estabelecimentos" })).toBeVisible();
}
