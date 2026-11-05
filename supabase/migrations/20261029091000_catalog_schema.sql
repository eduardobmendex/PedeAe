-- =====================================================================
-- Catálogo base: tipos de estabelecimento e produtos-modelo globais.
-- Os dados vêm de supabase/catalog/catalogo-base.mjs (migration gerada).
-- Ninguém altera o catálogo pela API: só leitura para usuários logados.
-- A importação COPIA os itens para o cardápio da organização.
-- =====================================================================

create table public.establishment_types (
  id           text primary key check (id ~ '^[a-z0-9-]+$'),
  name         text not null,
  description  text not null default '',
  sort_order   integer not null default 0
);

create table public.catalog_items (
  key              text primary key check (key ~ '^[a-z0-9-]+$'),
  category         text not null,
  category_sort    integer not null,
  name             text not null,
  description      text not null default '',
  -- Valor base fixo (estimativa de mercado para a Bahia), em centavos.
  price_cents      bigint not null check (price_cents >= 0),
  featured         boolean not null default false,
  -- Mesmo formato aceito por save_product_options.
  options          jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  types            text[] not null check (cardinality(types) > 0),
  sort_order       integer not null default 0,
  active           boolean not null default true,
  catalog_version  integer not null
);
create index catalog_items_types_idx on public.catalog_items using gin (types);

revoke all on public.establishment_types, public.catalog_items from anon, authenticated;
grant select on public.establishment_types, public.catalog_items to authenticated;

alter table public.establishment_types enable row level security;
alter table public.catalog_items enable row level security;
create policy establishment_types_read on public.establishment_types for select to authenticated using (true);
create policy catalog_items_read on public.catalog_items for select to authenticated using (active);

-- Origem do produto importado: evita duplicar na reimportação.
alter table public.products add column source_catalog_key text;
create unique index products_org_source_key_idx
  on public.products (organization_id, source_catalog_key) where source_catalog_key is not null;

-- ---------------------------------------------------------------------
-- Importação transacional.
-- p_items: [{"key": "pizza-grande", "price_cents": 6000}]  (price_cents opcional)
-- Regras:
--   * item já importado nesta organização => ignorado (sem duplicar);
--   * categoria inexistente => criada OCULTA (rascunho até o admin publicar);
--   * categoria existente e visível => produto entra como indisponível,
--     para nada aparecer aos clientes sem revisão.
-- ---------------------------------------------------------------------
create function public.import_catalog_items(p_org_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_category_id uuid;
  v_category_active boolean;
  v_product_id uuid;
  v_option_id uuid;
  v_price bigint;
  v_group jsonb;
  v_item jsonb;
  v_g int;
  v_i int;
  v_imported int := 0;
  v_skipped int := 0;
  v_categories int := 0;
  v_found int;
begin
  if not private.can(p_org_id, 'manage_menu') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500 then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  select count(distinct ci.key) into v_found
  from jsonb_array_elements(p_items) r
  join public.catalog_items ci on ci.key = r.value ->> 'key' and ci.active;
  if v_found <> (select count(distinct r.value ->> 'key') from jsonb_array_elements(p_items) r) then
    raise exception 'catalog_item_not_found' using errcode = 'P0001';
  end if;

  -- Chaves repetidas no pedido de importação valem uma vez só.
  for v_row in
    select ci.*, req.price_override
    from (
      select distinct on (r.value ->> 'key') r.value ->> 'key' as key, r.value -> 'price_cents' as price_override
      from jsonb_array_elements(p_items) r
    ) req
    join public.catalog_items ci on ci.key = req.key
    order by ci.category_sort, ci.sort_order
  loop
    if exists (
      select 1 from public.products where organization_id = p_org_id and source_catalog_key = v_row.key
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_price := coalesce((v_row.price_override #>> '{}')::bigint, v_row.price_cents);
    if v_price < 0 or v_price > 100000000 then
      raise exception 'invalid_price' using errcode = 'P0001', detail = v_row.name;
    end if;

    select id, active into v_category_id, v_category_active
    from public.categories
    where organization_id = p_org_id and lower(name) = lower(v_row.category)
    order by created_at
    limit 1;

    if v_category_id is null then
      insert into public.categories (organization_id, name, sort_order, active)
      values (p_org_id, v_row.category,
              coalesce((select max(sort_order) from public.categories where organization_id = p_org_id), 0) + 1,
              false)
      returning id, active into v_category_id, v_category_active;
      v_categories := v_categories + 1;
    end if;

    insert into public.products (organization_id, category_id, name, description, price_cents, featured,
      available, sort_order, source_catalog_key)
    values (p_org_id, v_category_id, v_row.name, v_row.description, v_price, v_row.featured,
      not v_category_active, v_row.sort_order, v_row.key)
    returning id into v_product_id;

    v_g := 0;
    for v_group in select * from jsonb_array_elements(v_row.options) loop
      v_g := v_g + 1;
      insert into public.product_options (organization_id, product_id, name, min_select, max_select, price_rule, sort_order)
      values (p_org_id, v_product_id, v_group ->> 'name', (v_group ->> 'min_select')::int,
              (v_group ->> 'max_select')::int, coalesce(v_group ->> 'price_rule', 'sum'), v_g)
      returning id into v_option_id;

      v_i := 0;
      for v_item in select * from jsonb_array_elements(v_group -> 'items') loop
        v_i := v_i + 1;
        insert into public.product_option_items (organization_id, option_id, name, price_delta_cents, available, sort_order)
        values (p_org_id, v_option_id, v_item ->> 'name', coalesce((v_item ->> 'price_delta_cents')::bigint, 0), true, v_i);
      end loop;
    end loop;

    v_imported := v_imported + 1;
  end loop;

  perform private.write_audit(p_org_id, 'catalog.imported', 'organization', p_org_id::text,
    jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'categories_created', v_categories));

  return jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'categories_created', v_categories);
end;
$$;

revoke all on function public.import_catalog_items(uuid, jsonb) from public, anon;
grant execute on function public.import_catalog_items(uuid, jsonb) to authenticated;
