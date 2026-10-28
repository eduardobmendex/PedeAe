import { describe, expect, it } from "vitest";
import { withRollback, type Db, type TestUser } from "./helpers";

async function addMember(db: Db, admin: TestUser, orgId: string, user: TestUser, role: "staff" | "supervisor") {
  await db.as(admin);
  const [{ token }] = await db.query<{ token: string }>("select public.create_invitation($1, $2, $3) as token", [
    orgId,
    user.email,
    role,
  ]);
  await db.as(user);
  await db.query("select public.accept_invitation($1)", [token]);
}

async function seedMenu(db: Db, admin: TestUser, orgId: string) {
  await db.as(admin);
  const [cat] = await db.query<{ id: string }>(
    "insert into categories (organization_id, name) values ($1, 'Pastéis') returning id",
    [orgId],
  );
  const [prod] = await db.query<{ id: string }>(
    `insert into products (organization_id, category_id, name, price_cents)
     values ($1, $2, 'Pastel de carne', 1200) returning id`,
    [orgId, cat.id],
  );
  await db.query(
    `insert into products (organization_id, category_id, name, price_cents, available)
     values ($1, $2, 'Pastel esgotado', 1000, false)`,
    [orgId, cat.id],
  );
  return { categoryId: cat.id, productId: prod.id };
}

describe("cardápio", () => {
  it("produto não pode apontar para categoria de outra organização", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const orgA = await db.createOrg(ana, "Pastelaria A");
      const orgB = await db.createOrg(bruno, "Hamburgueria B");
      const { categoryId: catB } = await seedMenu(db, bruno, orgB);

      await db.as(ana);
      expect(
        await db.expectError(
          "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'X', 100)",
          [orgA, catB],
        ),
      ).toMatch(/foreign key/);
      // E nem consegue ler o cardápio interno da outra organização.
      expect(await db.query("select id from products where organization_id = $1", [orgB])).toEqual([]);
    }));

  it("funcionário não edita o cardápio; supervisor edita por padrão", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const carla = await db.createUser("carla");
      const sara = await db.createUser("sara");
      const orgA = await db.createOrg(ana, "Pastelaria A");
      const { categoryId, productId } = await seedMenu(db, ana, orgA);
      await addMember(db, ana, orgA, carla, "staff");
      await addMember(db, ana, orgA, sara, "supervisor");

      await db.as(carla);
      expect(await db.query("select id from products where id = $1", [productId])).toHaveLength(1);
      expect(await db.query("update products set price_cents = 1 where id = $1 returning id", [productId])).toEqual([]);
      expect(
        await db.expectError(
          "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'X', 100)",
          [orgA, categoryId],
        ),
      ).toMatch(/row-level security/);
      expect(await db.expectError("select public.save_product_options($1, '[]')", [productId])).toMatch(/forbidden/);

      await db.as(sara);
      expect(await db.query("update products set price_cents = 1500 where id = $1 returning id", [productId])).toHaveLength(1);

      await db.as(ana);
      const logs = await db.query<{ action: string }>(
        "select action from audit_logs where organization_id = $1 and entity_id = $2",
        [orgA, productId],
      );
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["products.insert", "products.update"]));
    }));

  it("adicionais são salvos de forma transacional e validados", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Pastelaria A");
      const { productId } = await seedMenu(db, ana, orgA);

      await db.as(ana);
      const groups = [
        { name: "Tamanho", min_select: 1, max_select: 1, items: [{ name: "Médio" }, { name: "Grande", price_delta_cents: 300 }] },
        { name: "Extras", min_select: 0, max_select: 3, items: [{ name: "Queijo", price_delta_cents: 200 }] },
      ];
      await db.query("select public.save_product_options($1, $2)", [productId, JSON.stringify(groups)]);
      expect(await db.query("select id from product_options where product_id = $1", [productId])).toHaveLength(2);

      // Grupo inválido (min > max) desfaz tudo: os grupos anteriores continuam.
      const invalid = [{ name: "Ruim", min_select: 3, max_select: 1, items: [{ name: "A" }] }];
      expect(await db.expectError("select public.save_product_options($1, $2)", [productId, JSON.stringify(invalid)])).toMatch(
        /check constraint/,
      );
      expect(await db.query("select id from product_options where product_id = $1", [productId])).toHaveLength(2);
    }));
});

describe("cardápio público e QR Codes", () => {
  it("visitante lê só o que está publicado e nunca as tabelas", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Pastelaria A");
      await seedMenu(db, ana, orgA);
      await db.as(ana);
      const [{ slug }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [orgA]);

      await db.as(null);
      expect(await db.expectError("select * from products")).toMatch(/permission denied/);
      expect(await db.expectError("select * from table_qr_codes")).toMatch(/permission denied/);

      const [{ menu }] = await db.query<{ menu: { categories: { products: { name: string }[] }[] } }>(
        "select public.get_public_menu($1) as menu",
        [slug],
      );
      expect(menu.categories).toHaveLength(1);
      expect(menu.categories[0].products.map((p) => p.name)).toEqual(["Pastel de carne"]);
    }));

  it("cada mesa nasce com QR Code; rotação invalida o código anterior", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Pastelaria A");

      await db.as(ana);
      const [table] = await db.query<{ id: string }>(
        "insert into tables (organization_id, name) values ($1, 'Mesa 1') returning id",
        [orgA],
      );
      const [{ token: oldToken }] = await db.query<{ token: string }>(
        "select token from table_qr_codes where table_id = $1 and revoked_at is null",
        [table.id],
      );
      const [{ token: newToken }] = await db.query<{ token: string }>("select public.rotate_table_qr($1) as token", [
        table.id,
      ]);

      await db.as(null);
      const resolve = async (t: string) =>
        (await db.query<{ r: { table_name: string } | null }>("select public.resolve_table_token($1) as r", [t]))[0].r;
      expect(await resolve(oldToken)).toBeNull();
      expect((await resolve(newToken))?.table_name).toBe("Mesa 1");

      await db.as(ana);
      await db.query("update tables set active = false where id = $1", [table.id]);
      await db.as(null);
      expect(await resolve(newToken)).toBeNull();
    }));
});
