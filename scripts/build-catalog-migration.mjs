// Gera a migration com os dados do catálogo base a partir de
// supabase/catalog/catalogo-base.mjs, validando a consistência antes.
//
//   node scripts/build-catalog-migration.mjs
//
// Itens removidos do arquivo ficam inativos (não são apagados), para não
// quebrar a referência de produtos já importados.
import { existsSync, writeFileSync } from "node:fs";
import { CATALOG_VERSION, catalogItems, categoryOrder, establishmentTypes } from "../supabase/catalog/catalogo-base.mjs";
import { externalPhotos, imagePath, itemPhotos, photos } from "../supabase/catalog/imagens.mjs";

const typeIds = new Set(establishmentTypes.map((t) => t.id));
const errors = [];
const keys = new Set();

for (const item of catalogItems) {
  const where = `item ${item.key}`;
  if (!/^[a-z0-9-]+$/.test(item.key)) errors.push(`${where}: chave inválida`);
  if (keys.has(item.key)) errors.push(`${where}: chave duplicada`);
  keys.add(item.key);
  if (!categoryOrder.includes(item.category)) errors.push(`${where}: categoria "${item.category}" fora de categoryOrder`);
  if (!item.types?.length || item.types.some((t) => !typeIds.has(t))) errors.push(`${where}: tipos inválidos`);
  if (!Number.isInteger(item.price) || item.price < 0) errors.push(`${where}: preço precisa ser centavos inteiros`);
  for (const g of item.options ?? []) {
    if (g.min > g.max || g.max < 1) errors.push(`${where}/${g.name}: min/max inválidos`);
    if (g.min > g.items.length) errors.push(`${where}/${g.name}: mínimo maior que itens`);
    if (g.rule && !["sum", "max", "avg"].includes(g.rule)) errors.push(`${where}/${g.name}: regra inválida`);
    for (const i of g.items) {
      if (i.price !== undefined && (!Number.isInteger(i.price) || i.price < 0)) errors.push(`${where}/${g.name}/${i.name}: preço inválido`);
    }
  }
  // Produto com preço base 0 precisa de grupo obrigatório que defina o preço.
  if (item.price === 0 && !(item.options ?? []).some((g) => g.min > 0 && g.items.every((i) => (i.price ?? 0) > 0))) {
    errors.push(`${where}: preço 0 sem grupo obrigatório com preço`);
  }
}
for (const [key, photo] of Object.entries(itemPhotos)) {
  if (!keys.has(key)) errors.push(`foto de item inexistente: ${key}`);
  if (!photos[photo] && !externalPhotos[photo]) errors.push(`foto ${photo} sem origem registrada`);
  if (!externalPhotos[photo] && !existsSync(`public${imagePath(photo)}`)) errors.push(`arquivo da foto ${photo} não baixado`);
}
for (const t of establishmentTypes) {
  if (!catalogItems.some((i) => i.types.includes(t.id))) errors.push(`tipo ${t.id} sem itens`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;

const typesSql = establishmentTypes
  .map((t, i) => `  (${lit(t.id)}, ${lit(t.name)}, ${lit(t.description)}, ${i + 1})`)
  .join(",\n");

const sortInCategory = new Map();
const itemsSql = catalogItems
  .map((item) => {
    const n = (sortInCategory.get(item.category) ?? 0) + 1;
    sortInCategory.set(item.category, n);
    const options = (item.options ?? []).map((g) => ({
      name: g.name,
      min_select: g.min,
      max_select: g.max,
      price_rule: g.rule ?? "sum",
      items: g.items.map((i) => ({ name: i.name, price_delta_cents: i.price ?? 0 })),
    }));
    return `  (${lit(item.key)}, ${lit(item.category)}, ${categoryOrder.indexOf(item.category) + 1}, ${lit(item.name)}, ${lit(item.description ?? "")}, ${item.price}, ${item.featured ? "true" : "false"}, ${json(options)}, array[${item.types.map(lit).join(", ")}], ${n}, ${CATALOG_VERSION}, ${itemPhotos[item.key] ? lit(imagePath(itemPhotos[item.key])) : "null"})`;
  })
  .join(",\n");

const sql = `-- =====================================================================
-- GERADO por scripts/build-catalog-migration.mjs — não edite à mão.
-- Catálogo base v${CATALOG_VERSION}: ${establishmentTypes.length} tipos, ${catalogItems.length} itens.
-- =====================================================================

insert into public.establishment_types (id, name, description, sort_order) values
${typesSql}
on conflict (id) do update set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

insert into public.catalog_items
  (key, category, category_sort, name, description, price_cents, featured, options, types, sort_order, catalog_version, image_path)
values
${itemsSql}
on conflict (key) do update set
  category = excluded.category, category_sort = excluded.category_sort, name = excluded.name,
  description = excluded.description, price_cents = excluded.price_cents, featured = excluded.featured,
  options = excluded.options, types = excluded.types, sort_order = excluded.sort_order,
  catalog_version = excluded.catalog_version, image_path = excluded.image_path, active = true;

-- Itens que saíram do catálogo ficam inativos.
update public.catalog_items set active = false where catalog_version < ${CATALOG_VERSION};

-- Produtos importados acompanham a foto do catálogo; foto enviada pelo estabelecimento não muda.
update public.products p set image_path = ci.image_path
from public.catalog_items ci
where p.source_catalog_key = ci.key
  and ci.image_path is not null
  and p.image_path is distinct from ci.image_path
  and (p.image_path is null or p.image_path like '/catalog/%' or p.image_path like 'https://%');
`;

const file = `supabase/migrations/${process.argv[2] ?? "20261029092000"}_catalog_data_v${CATALOG_VERSION}.sql`;
writeFileSync(file, sql);
console.log(`${file}: ${catalogItems.length} itens, ${establishmentTypes.length} tipos`);
