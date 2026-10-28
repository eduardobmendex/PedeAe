-- =====================================================================
-- Etapa 3 — Cardápio, adicionais, mesas, QR Codes, imagens e leitura pública
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cardápio
-- ---------------------------------------------------------------------
create table public.categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  sort_order       integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create index categories_org_sort_idx on public.categories (organization_id, sort_order);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  category_id      uuid not null,
  name             text not null check (char_length(name) between 1 and 120),
  description      text not null default '' check (char_length(description) <= 600),
  price_cents      bigint not null check (price_cents >= 0 and price_cents <= 100000000),
  image_path       text,
  available        boolean not null default true,
  featured         boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  -- Chave composta: o produto só pode apontar para categoria da MESMA organização.
  foreign key (organization_id, category_id) references public.categories (organization_id, id) on delete restrict
);
create index products_org_category_idx on public.products (organization_id, category_id, sort_order);

create table public.product_options (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  product_id       uuid not null,
  name             text not null check (char_length(name) between 1 and 80),
  min_select       integer not null default 0 check (min_select >= 0),
  max_select       integer not null default 1 check (max_select >= 1),
  sort_order       integer not null default 0,
  unique (organization_id, id),
  check (min_select <= max_select),
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete cascade
);
create index product_options_product_idx on public.product_options (product_id, sort_order);

create table public.product_option_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  option_id          uuid not null,
  name               text not null check (char_length(name) between 1 and 80),
  price_delta_cents  bigint not null default 0 check (price_delta_cents >= 0 and price_delta_cents <= 100000000),
  available          boolean not null default true,
  sort_order         integer not null default 0,
  foreign key (organization_id, option_id) references public.product_options (organization_id, id) on delete cascade
);
create index product_option_items_option_idx on public.product_option_items (option_id, sort_order);

-- ---------------------------------------------------------------------
-- Mesas e QR Codes
-- ---------------------------------------------------------------------
create table public.tables (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 40),
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

-- O token vai impresso no QR Code (é público por natureza); a proteção é a
-- aleatoriedade (96 bits) e a possibilidade de revogar/rotacionar.
create table public.table_qr_codes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  table_id         uuid not null,
  token            text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  foreign key (organization_id, table_id) references public.tables (organization_id, id) on delete cascade
);
-- No máximo um código ativo por mesa.
create unique index table_qr_codes_one_active_idx on public.table_qr_codes (table_id) where revoked_at is null;

create trigger categories_updated_at before update on public.categories
  for each row execute function private.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger tables_updated_at before update on public.tables
  for each row execute function private.set_updated_at();

-- Toda mesa nova já nasce com um QR Code ativo.
create function private.create_table_qr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.table_qr_codes (organization_id, table_id) values (new.organization_id, new.id);
  return new;
end;
$$;

create trigger tables_create_qr after insert on public.tables
  for each row execute function private.create_table_qr();

-- ---------------------------------------------------------------------
-- Auditoria (insert/update/delete) de cardápio e mesas
-- ---------------------------------------------------------------------
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_changes jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('from', to_jsonb(old) -> key, 'to', value)) into v_changes
    from jsonb_each(to_jsonb(new) - 'updated_at')
    where to_jsonb(old) -> key is distinct from value;
    if v_changes is null then
      return new;
    end if;
  else
    v_changes := v_row - 'updated_at' - 'created_at';
  end if;

  perform private.write_audit((v_row ->> 'organization_id')::uuid,
    tg_table_name || '.' || lower(tg_op), tg_table_name, v_row ->> 'id', v_changes);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function private.audit_row_change();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function private.audit_row_change();
create trigger tables_audit after insert or update or delete on public.tables
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------
-- Privilégios e RLS
-- ---------------------------------------------------------------------
revoke all on public.categories, public.products, public.product_options,
  public.product_option_items, public.tables, public.table_qr_codes from anon, authenticated;

grant select, insert, update, delete on public.categories, public.products, public.tables to authenticated;
grant select on public.product_options, public.product_option_items, public.table_qr_codes to authenticated;

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_options enable row level security;
alter table public.product_option_items enable row level security;
alter table public.tables enable row level security;
alter table public.table_qr_codes enable row level security;

-- Leitura: qualquer membro ativo. Escrita: quem tem a permissão da matriz.
create policy categories_select on public.categories for select to authenticated
  using (private.has_org_role(organization_id));
create policy categories_write on public.categories for all to authenticated
  using (private.can(organization_id, 'manage_menu'))
  with check (private.can(organization_id, 'manage_menu'));

create policy products_select on public.products for select to authenticated
  using (private.has_org_role(organization_id));
create policy products_write on public.products for all to authenticated
  using (private.can(organization_id, 'manage_menu'))
  with check (private.can(organization_id, 'manage_menu'));

create policy product_options_select on public.product_options for select to authenticated
  using (private.has_org_role(organization_id));
create policy product_option_items_select on public.product_option_items for select to authenticated
  using (private.has_org_role(organization_id));

create policy tables_select on public.tables for select to authenticated
  using (private.has_org_role(organization_id));
create policy tables_write on public.tables for all to authenticated
  using (private.can(organization_id, 'manage_tables'))
  with check (private.can(organization_id, 'manage_tables'));

create policy table_qr_codes_select on public.table_qr_codes for select to authenticated
  using (private.has_org_role(organization_id));

-- ---------------------------------------------------------------------
-- RPCs do painel
-- ---------------------------------------------------------------------

-- Substitui, de forma transacional, todos os grupos de adicionais de um produto.
-- p_groups: [{"name", "min_select", "max_select", "items": [{"name", "price_delta_cents", "available"}]}]
create function public.save_product_options(p_product_id uuid, p_groups jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_group jsonb;
  v_item jsonb;
  v_option_id uuid;
  v_g int := 0;
  v_i int;
begin
  select organization_id into v_org from public.products where id = p_product_id;
  if v_org is null or not private.can(v_org, 'manage_menu') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) > 20 then
    raise exception 'invalid_options' using errcode = 'P0001';
  end if;

  delete from public.product_options where product_id = p_product_id;

  for v_group in select * from jsonb_array_elements(p_groups) loop
    v_g := v_g + 1;
    insert into public.product_options (organization_id, product_id, name, min_select, max_select, sort_order)
    values (v_org, p_product_id, trim(v_group ->> 'name'),
            coalesce((v_group ->> 'min_select')::int, 0), coalesce((v_group ->> 'max_select')::int, 1), v_g)
    returning id into v_option_id;

    if jsonb_array_length(coalesce(v_group -> 'items', '[]')) = 0 then
      raise exception 'invalid_options' using errcode = 'P0001';
    end if;

    v_i := 0;
    for v_item in select * from jsonb_array_elements(v_group -> 'items') loop
      v_i := v_i + 1;
      insert into public.product_option_items (organization_id, option_id, name, price_delta_cents, available, sort_order)
      values (v_org, v_option_id, trim(v_item ->> 'name'),
              coalesce((v_item ->> 'price_delta_cents')::bigint, 0),
              coalesce((v_item ->> 'available')::boolean, true), v_i);
    end loop;
  end loop;

  perform private.write_audit(v_org, 'product_options.replaced', 'product', p_product_id::text,
    jsonb_build_object('groups', p_groups));
end;
$$;

-- Revoga o QR Code atual da mesa e gera outro.
create function public.rotate_table_qr(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_token text;
begin
  select organization_id into v_org from public.tables where id = p_table_id;
  if v_org is null or not private.can(v_org, 'manage_tables') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.table_qr_codes set revoked_at = now() where table_id = p_table_id and revoked_at is null;
  insert into public.table_qr_codes (organization_id, table_id) values (v_org, p_table_id)
  returning token into v_token;

  perform private.write_audit(v_org, 'table_qr.rotated', 'table', p_table_id::text);
  return v_token;
end;
$$;

revoke all on function public.save_product_options(uuid, jsonb) from public, anon;
revoke all on function public.rotate_table_qr(uuid) from public, anon;
grant execute on function public.save_product_options(uuid, jsonb) to authenticated;
grant execute on function public.rotate_table_qr(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Leitura pública (visitante anônimo). Nada de tabela exposta ao anon:
-- somente estas funções, que devolvem apenas o que é publicado.
-- ---------------------------------------------------------------------
create function public.get_public_menu(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug),
    'branding', jsonb_build_object(
      'theme', s.theme, 'brand_color', s.brand_color, 'accent_color', s.accent_color,
      'logo_path', s.logo_path, 'cover_path', s.cover_path, 'settings', s.settings),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'products', (
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents,
            'image_path', p.image_path, 'featured', p.featured,
            'options', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', po.id, 'name', po.name, 'min_select', po.min_select, 'max_select', po.max_select,
                'items', coalesce((
                  select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'price_delta_cents', i.price_delta_cents)
                    order by i.sort_order)
                  from public.product_option_items i where i.option_id = po.id and i.available
                ), '[]'::jsonb)
              ) order by po.sort_order)
              from public.product_options po where po.product_id = p.id
            ), '[]'::jsonb)
          ) order by p.sort_order, p.name)
          from public.products p
          where p.category_id = c.id and p.available
        )
      ) order by c.sort_order, c.name)
      from public.categories c
      where c.organization_id = o.id and c.active
        and exists (select 1 from public.products p where p.category_id = c.id and p.available)
    ), '[]'::jsonb)
  )
  from public.organizations o
  join public.organization_settings s on s.organization_id = o.id
  where o.slug = lower(p_slug) and o.status = 'active';
$$;

-- Resolve o token do QR Code em estabelecimento + mesa (somente códigos e mesas ativos).
create function public.resolve_table_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', o.slug, 'table_id', t.id, 'table_name', t.name)
  from public.table_qr_codes q
  join public.tables t on t.id = q.table_id
  join public.organizations o on o.id = q.organization_id
  where q.token = p_token and q.revoked_at is null and t.active and o.status = 'active';
$$;

revoke all on function public.get_public_menu(text) from public;
revoke all on function public.resolve_table_token(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
grant execute on function public.resolve_table_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: imagens públicas do cardápio e da marca
-- Caminho obrigatório: <organization_id>/<arquivo>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function private.storage_org_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function private.storage_org_id(text) to authenticated;

create policy menu_images_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and (private.can(private.storage_org_id(name), 'manage_menu')
         or private.can(private.storage_org_id(name), 'manage_brand'))
  );
create policy menu_images_update on storage.objects for update to authenticated
  using (
    bucket_id = 'menu-images'
    and (private.can(private.storage_org_id(name), 'manage_menu')
         or private.can(private.storage_org_id(name), 'manage_brand'))
  );
create policy menu_images_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and (private.can(private.storage_org_id(name), 'manage_menu')
         or private.can(private.storage_org_id(name), 'manage_brand'))
  );
create policy menu_images_select_members on storage.objects for select to authenticated
  using (bucket_id = 'menu-images' and private.has_org_role(private.storage_org_id(name)));
