import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "./helpers";

// Foto padrão do catálogo base enviada pelo Admin Geral (tela /painel/catalogo).

const STELLA = "cerveja-stella-ln-330"; // sem foto no código
const MISTO = "sanduiche-misto"; // com foto do app (/catalog/...)
const path = (key: string) => `catalog-images/${key}/${randomUUID()}.webp`;

type SetResult = { previous: string | null; products: number; slugs: string[] };

async function setImage(db: Db, key: string, p: string | null, propagate = true) {
  const [{ r }] = await db.query<{ r: SetResult }>("select public.platform_set_catalog_image($1, $2, $3) as r", [key, p, propagate]);
  return r;
}

async function importItems(db: Db, orgId: string, keys: string[]) {
  await db.query("select public.import_catalog_items($1, $2)", [orgId, JSON.stringify(keys.map((key) => ({ key })))]);
}

async function productImage(db: Db, orgId: string, key: string) {
  await db.asSuperuser();
  const [row] = await db.query<{ image_path: string | null }>(
    "select image_path from products where organization_id = $1 and source_catalog_key = $2",
    [orgId, key],
  );
  return row?.image_path;
}

async function catalogItem(db: Db, key: string) {
  await db.asSuperuser();
  const [row] = await db.query<{ image_path: string | null; default_image_path: string | null; custom_image_path: string | null }>(
    "select image_path, default_image_path, custom_image_path from catalog_items where key = $1",
    [key],
  );
  return row;
}

describe("foto padrão do catálogo (Admin Geral)", () => {
  it("só o Admin Geral define, com caminho da pasta do próprio item", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      await db.createOrg(ana, "Bar A");
      await db.as(ana);
      expect(await db.expectError("select public.platform_set_catalog_image($1, $2, true)", [STELLA, path(STELLA)])).toMatch(/forbidden/);

      await db.as(await db.getPlatformAdmin());
      expect(await db.expectError("select public.platform_set_catalog_image($1, $2, true)", [STELLA, path(MISTO)])).toMatch(/invalid_image/);
      expect(
        await db.expectError("select public.platform_set_catalog_image($1, $2, true)", [STELLA, `catalog-images/${STELLA}/../x.webp`]),
      ).toMatch(/invalid_image|check constraint/);
      expect(await db.expectError("select public.platform_set_catalog_image('nao-existe', null, true)")).toMatch(/not_found/);

      // Ninguém altera o catálogo direto pela API.
      expect(await db.expectError("update catalog_items set custom_image_path = null")).toMatch(/permission denied/);
    }));

  it("novas importações levam a foto; cardápios antigos são atualizados sem tocar na foto do estabelecimento", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const bia = await db.createUser("bia");
      const orgA = await db.createOrg(ana, "Bar A");
      await db.as(ana);
      await importItems(db, orgA, [STELLA, MISTO]);
      const orgB = await db.createOrg(bia, "Bar B");
      await db.as(bia);
      await importItems(db, orgB, [STELLA]);
      // Bar B enviou a própria foto da Stella.
      await db.query("update products set image_path = $1 where organization_id = $2 and source_catalog_key = $3", [
        `${orgB}/products/minha.jpg`,
        orgB,
        STELLA,
      ]);

      await db.as(await db.getPlatformAdmin());
      const photo = path(STELLA);
      const r = await setImage(db, STELLA, photo);
      const [{ slug: slugA }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [orgA]);
      const [{ slug: slugB }] = await db.query<{ slug: string }>("select slug from organizations where id = $1", [orgB]);
      expect(r.previous).toBeNull();
      expect(r.products).toBeGreaterThanOrEqual(1);
      expect(r.slugs).toContain(slugA);
      expect(r.slugs).not.toContain(slugB);

      expect(await catalogItem(db, STELLA)).toEqual({ image_path: photo, default_image_path: null, custom_image_path: photo });
      expect(await productImage(db, orgA, STELLA)).toBe(photo);
      expect(await productImage(db, orgB, STELLA)).toBe(`${orgB}/products/minha.jpg`);

      // Novo estabelecimento importa e já recebe a foto.
      const caio = await db.createUser("caio");
      const orgC = await db.createOrg(caio, "Bar C");
      await db.as(caio);
      await importItems(db, orgC, [STELLA]);
      expect(await productImage(db, orgC, STELLA)).toBe(photo);

      // Uso por item (tela do Admin Geral).
      await db.as(await db.getPlatformAdmin());
      const usage = await db.query<{ key: string; organizations: number; using_catalog_photo: number }>(
        "select * from public.platform_catalog_usage() where key = $1",
        [STELLA],
      );
      expect(usage[0].organizations).toBeGreaterThanOrEqual(3);
      expect(usage[0].using_catalog_photo).toBeGreaterThanOrEqual(2);
      expect(usage[0].using_catalog_photo).toBeLessThan(usage[0].organizations);

      await db.as(ana);
      expect(await db.expectError("select * from public.platform_catalog_usage()")).toMatch(/forbidden/);
    }));

  it("sem propagar, só as próximas importações mudam; voltar à original restaura a foto do app", () =>
    withRollback(async (db) => {
      const ana = await db.createUser("ana");
      const orgA = await db.createOrg(ana, "Bar A");
      await db.as(ana);
      await importItems(db, orgA, [MISTO]);
      const original = await productImage(db, orgA, MISTO);
      expect(original).toMatch(/^\/catalog\//);

      await db.as(await db.getPlatformAdmin());
      const first = path(MISTO);
      expect((await setImage(db, MISTO, first, false)).products).toBe(0);
      expect(await productImage(db, orgA, MISTO)).toBe(original);
      expect((await catalogItem(db, MISTO)).image_path).toBe(first);

      // Troca de novo propagando: devolve a anterior para o app apagar do Storage.
      await db.as(await db.getPlatformAdmin());
      const second = path(MISTO);
      const r = await setImage(db, MISTO, second);
      expect(r.previous).toBe(first);
      expect(await productImage(db, orgA, MISTO)).toBe(second);

      await db.as(await db.getPlatformAdmin());
      await setImage(db, MISTO, null);
      expect(await catalogItem(db, MISTO)).toEqual({ image_path: original, default_image_path: original, custom_image_path: null });
      expect(await productImage(db, orgA, MISTO)).toBe(original);
    }));

  it("nova versão do catálogo (migration gerada) não apaga a foto enviada", () =>
    withRollback(async (db) => {
      await db.as(await db.getPlatformAdmin());
      const photo = path(MISTO);
      await setImage(db, MISTO, photo, false);

      // Mesmo upsert que scripts/build-catalog-migration.mjs gera.
      await db.asSuperuser();
      await db.query(`
        insert into catalog_items (key, category, category_sort, name, price_cents, types, catalog_version, default_image_path, image_path)
        values ('${MISTO}', 'Lanches', 1, 'Misto', 1000, array['bar'], 99, '/catalog/novo.webp', '/catalog/novo.webp')
        on conflict (key) do update set
          catalog_version = excluded.catalog_version, default_image_path = excluded.default_image_path,
          image_path = coalesce(public.catalog_items.custom_image_path, excluded.default_image_path)`);
      expect(await catalogItem(db, MISTO)).toEqual({ image_path: photo, default_image_path: "/catalog/novo.webp", custom_image_path: photo });
    }));

  it("'catalogo' é endereço reservado", () =>
    withRollback(async (db) => {
      await db.as(await db.getPlatformAdmin());
      expect(await db.expectError("select public.platform_create_organization('Catálogo', 'catalogo')")).toMatch(/organizations_slug_not_reserved/);
    }));
});
