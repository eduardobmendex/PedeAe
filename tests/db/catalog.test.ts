import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db, type TestUser } from "./helpers";

type ImportResult = { imported: number; skipped: number; categories_created: number };

async function importItems(db: Db, orgId: string, items: { key: string; price_cents?: number }[]) {
  const [{ r }] = await db.query<{ r: ImportResult }>("select public.import_catalog_items($1, $2) as r", [
    orgId,
    JSON.stringify(items),
  ]);
  return r;
}

async function addStaff(db: Db, admin: TestUser, orgId: string, user: TestUser) {
  await db.as(admin);
  const [{ token }] = await db.query<{ token: string }>("select public.create_invitation($1, $2, 'staff') as token", [
    orgId,
    user.email,
  ]);
  await db.as(user);
  await db.query("select public.accept_invitation($1)", [token]);
}

describe("catálogo base", () => {
  it("todos os tipos têm itens e o catálogo é somente leitura", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      await db.as(ana);
      const types = await db.query<{ id: string; n: string }>(
        `select t.id, count(ci.key) as n from establishment_types t
         left join catalog_items ci on t.id = any (ci.types) group by t.id`,
      );
      expect(types.length).toBeGreaterThanOrEqual(5);
      expect(types.every((t) => Number(t.n) > 0)).toBe(true);

      expect(await db.expectError("update catalog_items set price_cents = 1")).toMatch(/permission denied/);
      expect(await db.expectError("insert into establishment_types (id, name) values ('x', 'X')")).toMatch(/permission denied/);
      await db.as(null);
      expect(await db.expectError("select * from catalog_items")).toMatch(/permission denied/);
    }));

  it("importa com preço editado, categoria oculta e sem duplicar na reimportação", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Bar A");
      await db.as(ana);

      const first = await importItems(db, orgA, [
        { key: "cerveja-heineken-ln-330", price_cents: 1350 },
        { key: "porcao-batata-frita" },
        { key: "pizza-grande" },
      ]);
      expect(first).toEqual({ imported: 3, skipped: 0, categories_created: 3 });

      const products = await db.query<{ name: string; price_cents: string; available: boolean; active: boolean }>(
        `select p.name, p.price_cents, p.available, c.active from products p join categories c on c.id = p.category_id
         where p.organization_id = $1 order by p.name`,
        [orgA],
      );
      expect(products.find((p) => p.name.startsWith("Heineken"))?.price_cents).toBe("1350");
      // Rascunho: categorias criadas ocultas; produtos prontos para quando forem publicadas.
      expect(products.every((p) => p.active === false && p.available === true)).toBe(true);

      const options = await db.query<{ name: string; price_rule: string; n: string }>(
        `select o.name, o.price_rule, count(i.id) as n from product_options o
         join products p on p.id = o.product_id join product_option_items i on i.option_id = o.id
         where p.organization_id = $1 and p.source_catalog_key = 'pizza-grande' group by o.name, o.price_rule`,
        [orgA],
      );
      expect(options.find((o) => o.name === "Sabores")?.price_rule).toBe("max");

      const again = await importItems(db, orgA, [{ key: "cerveja-heineken-ln-330" }, { key: "cerveja-skol-600" }]);
      expect(again).toEqual({ imported: 1, skipped: 1, categories_created: 0 });

      // Categoria já publicada: novos produtos entram indisponíveis até revisão.
      await db.query("update categories set active = true where organization_id = $1 and name = 'Cervejas'", [orgA]);
      await importItems(db, orgA, [{ key: "cerveja-brahma-600" }]);
      const [brahma] = await db.query<{ available: boolean }>(
        "select available from products where organization_id = $1 and source_catalog_key = 'cerveja-brahma-600'",
        [orgA],
      );
      expect(brahma.available).toBe(false);
    }));

  it("produto importado só aparece no cardápio público depois de publicar a categoria", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Bar A");
      await db.as(ana);
      await importItems(db, orgA, [{ key: "cerveja-skol-600" }]);
      const [{ slug }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [orgA]);
      const publicProducts = async () => {
        await db.as(null);
        const [{ menu }] = await db.query<{ menu: { categories: { products: { name: string }[] }[] } }>(
          "select public.get_public_menu($1) as menu",
          [slug],
        );
        await db.as(ana);
        return menu.categories.flatMap((c) => c.products.map((p) => p.name));
      };

      expect(await publicProducts()).toEqual([]);
      await db.query("update categories set active = true where organization_id = $1 and active = false", [orgA]);
      expect(await publicProducts()).toEqual(["Skol garrafa 600 ml"]);
    }));

  it("o produto importado leva a foto do catálogo", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Bar A");
      await db.as(ana);
      await importItems(db, orgA, [{ key: "drink-caipirinha" }, { key: "sanduiche-misto" }, { key: "cerveja-skol-600" }]);
      const rows = await db.query<{ source_catalog_key: string; image_path: string | null }>(
        "select source_catalog_key, image_path from products where organization_id = $1",
        [orgA],
      );
      const image = (key: string) => rows.find((r) => r.source_catalog_key === key)?.image_path;
      expect(image("drink-caipirinha")).toMatch(/^https:\/\//);
      expect(image("sanduiche-misto")).toMatch(/^\/catalog\/[a-z0-9-]+\.webp$/);
      // Bebida de marca fica sem foto de propósito.
      expect(image("cerveja-skol-600")).toBeNull();
    }));

  it("importação é tudo-ou-nada e exige permissão no próprio estabelecimento", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bruno = await db.createUser("bruno");
      const carla = await db.createUser("carla");
      const orgA = await db.createOrg(ana, "Bar A");
      const orgB = await db.createOrg(bruno, "Bar B");
      await addStaff(db, ana, orgA, carla);

      await db.as(ana);
      expect(
        await db.expectError("select public.import_catalog_items($1, $2)", [
          orgA,
          JSON.stringify([{ key: "porcao-batata-frita" }, { key: "nao-existe" }]),
        ]),
      ).toMatch(/catalog_item_not_found/);
      expect(
        await db.expectError("select public.import_catalog_items($1, $2)", [
          orgA,
          JSON.stringify([{ key: "porcao-batata-frita" }, { key: "cerveja-skol-600", price_cents: -1 }]),
        ]),
      ).toMatch(/invalid_price/);
      expect(await db.query("select id from products where organization_id = $1", [orgA])).toEqual([]);

      expect(
        await db.expectError("select public.import_catalog_items($1, $2)", [orgB, JSON.stringify([{ key: "cerveja-skol-600" }])]),
      ).toMatch(/forbidden/);

      await db.as(carla);
      expect(
        await db.expectError("select public.import_catalog_items($1, $2)", [orgA, JSON.stringify([{ key: "cerveja-skol-600" }])]),
      ).toMatch(/forbidden/);
    }));
});

describe("regra de preço por grupo", () => {
  it("pizza meio a meio cobra o sabor mais caro; borda soma", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Pizzaria A");
      await db.as(ana);
      await importItems(db, orgA, [{ key: "pizza-grande" }]);
      await db.query("update categories set active = true where organization_id = $1", [orgA]);
      const [table] = await db.query<{ id: string }>(
        "insert into tables (organization_id, name) values ($1, 'Mesa 1') returning id",
        [orgA],
      );
      const [{ token }] = await db.query<{ token: string }>("select token from table_qr_codes where table_id = $1", [table.id]);

      const rows = await db.query<{ product_id: string; option_id: string; option: string; item_id: string; item: string; price: string }>(
        `select p.id as product_id, o.id as option_id, o.name as option, i.id as item_id, i.name as item, i.price_delta_cents as price
         from products p join product_options o on o.product_id = p.id join product_option_items i on i.option_id = o.id
         where p.organization_id = $1`,
        [orgA],
      );
      const pick = (option: string, item: string) => rows.find((r) => r.option === option && r.item === item)!;
      const mussarela = pick("Sabores", "Mussarela");
      const camarao = pick("Sabores", "Camarão");
      const borda = pick("Borda recheada", "Catupiry");

      await db.as(null);
      const [{ r }] = await db.query<{ r: { total_cents: number } }>(
        "select public.create_customer_order($1, $2, null, null, $3) as r",
        [
          token,
          JSON.stringify([
            {
              product_id: mussarela.product_id,
              quantity: 1,
              options: [
                { option_id: mussarela.option_id, item_ids: [mussarela.item_id, camarao.item_id] },
                { option_id: borda.option_id, item_ids: [borda.item_id] },
              ],
            },
          ]),
          randomUUID(),
        ],
      );
      expect(r.total_cents).toBe(Number(camarao.price) + Number(borda.price));
    }));

  it("média arredonda ao centavo", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Loja");
      await db.as(ana);
      const [cat] = await db.query<{ id: string }>("insert into categories (organization_id, name) values ($1, 'X') returning id", [orgA]);
      const [prod] = await db.query<{ id: string }>(
        "insert into products (organization_id, category_id, name, price_cents) values ($1, $2, 'P', 1000) returning id",
        [orgA, cat.id],
      );
      await db.query("select public.save_product_options($1, $2)", [
        prod.id,
        JSON.stringify([
          { name: "Sabores", min_select: 2, max_select: 2, price_rule: "avg", items: [{ name: "A", price_delta_cents: 100 }, { name: "B", price_delta_cents: 201 }] },
        ]),
      ]);
      const items = await db.query<{ option_id: string; id: string }>(
        "select i.option_id, i.id from product_option_items i join product_options o on o.id = i.option_id where o.product_id = $1",
        [prod.id],
      );
      const [{ r }] = await db.query<{ r: { total_cents: number } }>(
        "select public.create_manual_order($1, null, $2, null, null, $3) as r",
        [orgA, JSON.stringify([{ product_id: prod.id, quantity: 1, options: [{ option_id: items[0].option_id, item_ids: items.map((i) => i.id) }] }]), randomUUID()],
      );
      // 1000 + round((100 + 201) / 2) = 1000 + 151
      expect(r.total_cents).toBe(1151);
    }));
});
