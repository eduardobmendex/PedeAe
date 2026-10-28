-- =====================================================================
-- Etapa 4 — Sessões de mesa, pedidos, itens com snapshot, eventos e
-- criação transacional/idempotente (cliente via QR e funcionário).
-- =====================================================================

create type public.order_status as enum
  ('pending_confirmation', 'received', 'preparing', 'ready', 'delivered', 'rejected', 'cancelled');
create type public.payment_status as enum
  ('unpaid', 'pending', 'paid', 'failed', 'partially_refunded', 'refunded');
create type public.order_source as enum ('customer', 'staff');
create type public.table_session_status as enum ('open', 'closed');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.table_sessions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  table_id         uuid not null,
  status           public.table_session_status not null default 'open',
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        uuid references auth.users (id) on delete set null,
  unique (organization_id, id),
  foreign key (organization_id, table_id) references public.tables (organization_id, id) on delete restrict
);
-- Uma única sessão aberta por mesa (concorrência resolvida pelo índice).
create unique index table_sessions_one_open_idx on public.table_sessions (table_id) where status = 'open';

-- Numeração sequencial de pedidos por estabelecimento.
create table public.order_counters (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  last_number      bigint not null default 0
);

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  table_id          uuid,
  table_session_id  uuid,
  order_number      bigint not null,
  status            public.order_status not null,
  payment_status    public.payment_status not null default 'unpaid',
  source            public.order_source not null,
  customer_name     text check (char_length(customer_name) <= 60),
  notes             text check (char_length(notes) <= 280),
  subtotal_cents    bigint not null check (subtotal_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  total_cents       bigint not null check (total_cents >= 0),
  created_by        uuid references auth.users (id) on delete set null,
  idempotency_key   uuid not null,
  -- Token do link de acompanhamento do cliente (não adivinhável).
  public_token      text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, order_number),
  unique (organization_id, idempotency_key),
  check (total_cents = subtotal_cents - discount_cents),
  foreign key (organization_id, table_id) references public.tables (organization_id, id) on delete restrict,
  foreign key (organization_id, table_session_id) references public.table_sessions (organization_id, id) on delete restrict
);
create index orders_org_status_idx on public.orders (organization_id, status, created_at desc);
create index orders_org_created_idx on public.orders (organization_id, created_at desc);
create index orders_session_idx on public.orders (table_session_id);

create table public.order_items (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null,
  order_id               uuid not null,
  product_id             uuid,
  product_name_snapshot  text not null,
  unit_price_cents       bigint not null check (unit_price_cents >= 0),
  quantity               integer not null check (quantity between 1 and 50),
  line_total_cents       bigint not null check (line_total_cents >= 0),
  notes                  text check (char_length(notes) <= 140),
  sort_order             integer not null default 0,
  unique (organization_id, id),
  check (line_total_cents = unit_price_cents * quantity),
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict,
  -- Excluir o produto do cardápio não apaga o histórico: só desvincula.
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete set null (product_id)
);
create index order_items_order_idx on public.order_items (order_id, sort_order);

create table public.order_item_options (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  order_item_id         uuid not null,
  option_name_snapshot  text not null,
  item_name_snapshot    text not null,
  price_cents           bigint not null check (price_cents >= 0),
  foreign key (organization_id, order_item_id) references public.order_items (organization_id, id) on delete restrict
);
create index order_item_options_item_idx on public.order_item_options (order_item_id);

create table public.order_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  order_id         uuid not null,
  actor_user_id    uuid references auth.users (id) on delete set null,
  from_status      public.order_status,
  to_status        public.order_status not null,
  note             text,
  created_at       timestamptz not null default now(),
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict
);
create index order_events_order_idx on public.order_events (order_id, created_at);

create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Privilégios e RLS: leitura para membros; escrita somente pelas RPCs.
-- ---------------------------------------------------------------------
revoke all on public.table_sessions, public.order_counters, public.orders, public.order_items,
  public.order_item_options, public.order_events from anon, authenticated;
grant select on public.table_sessions, public.orders, public.order_items,
  public.order_item_options, public.order_events to authenticated;

alter table public.table_sessions enable row level security;
alter table public.order_counters enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;
alter table public.order_events enable row level security;

create policy table_sessions_select on public.table_sessions for select to authenticated
  using (private.has_org_role(organization_id));
create policy orders_select on public.orders for select to authenticated
  using (private.can(organization_id, 'view_orders'));
create policy order_items_select on public.order_items for select to authenticated
  using (private.can(organization_id, 'view_orders'));
create policy order_item_options_select on public.order_item_options for select to authenticated
  using (private.can(organization_id, 'view_orders'));
create policy order_events_select on public.order_events for select to authenticated
  using (private.can(organization_id, 'view_orders'));

-- ---------------------------------------------------------------------
-- Núcleo: cria o pedido. Fonte oficial de preços e regras.
-- p_items: [{"product_id", "quantity", "notes", "options": [{"option_id", "item_ids": [...]}]}]
-- ---------------------------------------------------------------------
create function private.place_order(
  p_org_id uuid,
  p_table_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_notes text,
  p_idempotency_key uuid,
  p_source public.order_source,
  p_actor uuid,
  p_initial_status public.order_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders;
  v_order public.orders;
  v_session_id uuid;
  v_number bigint;
  v_item jsonb;
  v_product public.products;
  v_option public.product_options;
  v_sel jsonb;
  v_selected uuid[];
  v_count int;
  v_matched int;
  v_unit bigint;
  v_qty int;
  v_subtotal bigint := 0;
  v_order_item_id uuid;
  v_line int := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line_options jsonb;
  v_opt_item record;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency_key_required' using errcode = 'P0001';
  end if;

  -- Idempotência: a mesma chave devolve o pedido já criado.
  select * into v_existing from public.orders
  where organization_id = p_org_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
      'public_token', v_existing.public_token, 'status', v_existing.status,
      'total_cents', v_existing.total_cents, 'duplicate', true);
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'too_many_items' using errcode = 'P0001';
  end if;

  -- 1) Valida e precifica cada linha (ainda sem gravar).
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    v_qty := coalesce((v_item ->> 'quantity')::int, 0);
    if v_qty < 1 or v_qty > 50 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    select p.* into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.organization_id = p_org_id and p.available and c.active;
    if v_product.id is null then
      raise exception 'product_unavailable' using errcode = 'P0001',
        detail = coalesce(v_item ->> 'product_id', '');
    end if;

    -- Toda opção enviada precisa pertencer ao produto.
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb)) s
      where not exists (
        select 1 from public.product_options po
        where po.id = (s.value ->> 'option_id')::uuid and po.product_id = v_product.id)
    ) then
      raise exception 'invalid_options' using errcode = 'P0001', detail = v_product.name;
    end if;

    v_unit := v_product.price_cents;
    v_line_options := '[]'::jsonb;

    for v_option in
      select * from public.product_options where product_id = v_product.id order by sort_order
    loop
      select coalesce(array_agg(distinct x::uuid), '{}') into v_selected
      from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb)) s,
           jsonb_array_elements_text(coalesce(s.value -> 'item_ids', '[]'::jsonb)) x
      where (s.value ->> 'option_id')::uuid = v_option.id;

      v_count := coalesce(array_length(v_selected, 1), 0);
      if v_count < v_option.min_select or v_count > v_option.max_select then
        raise exception 'invalid_options' using errcode = 'P0001', detail = v_product.name;
      end if;

      v_matched := 0;
      for v_opt_item in
        select i.id, i.name, i.price_delta_cents
        from public.product_option_items i
        where i.option_id = v_option.id and i.id = any (v_selected) and i.available
        order by i.sort_order
      loop
        v_matched := v_matched + 1;
        v_unit := v_unit + v_opt_item.price_delta_cents;
        v_line_options := v_line_options || jsonb_build_object(
          'option', v_option.name, 'item', v_opt_item.name, 'price', v_opt_item.price_delta_cents);
      end loop;

      -- Item indisponível ou de outro grupo => contagem não bate.
      if v_matched <> v_count then
        raise exception 'option_unavailable' using errcode = 'P0001', detail = v_product.name;
      end if;
    end loop;

    v_subtotal := v_subtotal + v_unit * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id, 'name', v_product.name, 'unit', v_unit, 'qty', v_qty,
      'notes', nullif(left(trim(coalesce(v_item ->> 'notes', '')), 140), ''),
      'options', v_line_options, 'sort', v_line);
  end loop;

  -- 2) Sessão da mesa (abre se não houver uma aberta).
  if p_table_id is not null then
    select id into v_session_id from public.table_sessions
    where table_id = p_table_id and status = 'open' for update;
    if v_session_id is null then
      insert into public.table_sessions (organization_id, table_id) values (p_org_id, p_table_id)
      on conflict (table_id) where status = 'open' do nothing
      returning id into v_session_id;
      if v_session_id is null then
        select id into v_session_id from public.table_sessions where table_id = p_table_id and status = 'open';
      end if;
    end if;
  end if;

  -- 3) Número do pedido (linha bloqueada até o fim da transação).
  insert into public.order_counters (organization_id, last_number) values (p_org_id, 1)
  on conflict (organization_id) do update set last_number = public.order_counters.last_number + 1
  returning last_number into v_number;

  -- 4) Grava pedido, itens e adicionais.
  insert into public.orders (organization_id, table_id, table_session_id, order_number, status, source,
    customer_name, notes, subtotal_cents, discount_cents, total_cents, created_by, idempotency_key)
  values (p_org_id, p_table_id, v_session_id, v_number, p_initial_status, p_source,
    nullif(left(trim(coalesce(p_customer_name, '')), 60), ''), nullif(left(trim(coalesce(p_notes, '')), 280), ''),
    v_subtotal, 0, v_subtotal, p_actor, p_idempotency_key)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (organization_id, order_id, product_id, product_name_snapshot,
      unit_price_cents, quantity, line_total_cents, notes, sort_order)
    values (p_org_id, v_order.id, (v_item ->> 'product_id')::uuid, v_item ->> 'name',
      (v_item ->> 'unit')::bigint, (v_item ->> 'qty')::int,
      (v_item ->> 'unit')::bigint * (v_item ->> 'qty')::int, v_item ->> 'notes', (v_item ->> 'sort')::int)
    returning id into v_order_item_id;

    insert into public.order_item_options (organization_id, order_item_id, option_name_snapshot, item_name_snapshot, price_cents)
    select p_org_id, v_order_item_id, o ->> 'option', o ->> 'item', (o ->> 'price')::bigint
    from jsonb_array_elements(v_item -> 'options') o;
  end loop;

  insert into public.order_events (organization_id, order_id, actor_user_id, from_status, to_status)
  values (p_org_id, v_order.id, p_actor, null, v_order.status);

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
    'public_token', v_order.public_token, 'status', v_order.status,
    'total_cents', v_order.total_cents, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------
-- Pedido do cliente pelo QR Code da mesa (visitante anônimo).
-- ---------------------------------------------------------------------
create function public.create_customer_order(
  p_table_token text, p_items jsonb, p_customer_name text, p_notes text, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_existing jsonb;
  v_recent int;
  v_status public.order_status;
begin
  select t.id as table_id, t.organization_id, s.settings
  into v_table
  from public.table_qr_codes q
  join public.tables t on t.id = q.table_id
  join public.organizations o on o.id = q.organization_id
  join public.organization_settings s on s.organization_id = o.id
  where q.token = p_table_token and q.revoked_at is null and t.active and o.status = 'active';

  if v_table.table_id is null then
    raise exception 'table_invalid' using errcode = 'P0001';
  end if;

  -- Reenvio com a mesma chave: devolve o pedido existente sem contar no limite.
  select jsonb_build_object('order_id', id, 'order_number', order_number, 'public_token', public_token,
    'status', status, 'total_cents', total_cents, 'duplicate', true)
  into v_existing
  from public.orders where organization_id = v_table.organization_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Limite simples contra abuso: até 6 pedidos de cliente por mesa a cada 5 minutos.
  select count(*) into v_recent from public.orders
  where table_id = v_table.table_id and source = 'customer' and created_at > now() - interval '5 minutes';
  if v_recent >= 6 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  v_status := case when coalesce((v_table.settings ->> 'require_order_confirmation')::boolean, false)
                   then 'pending_confirmation' else 'received' end;

  return private.place_order(v_table.organization_id, v_table.table_id, p_items, p_customer_name, p_notes,
    p_idempotency_key, 'customer', null, v_status);
end;
$$;

-- ---------------------------------------------------------------------
-- Pedido lançado por funcionário (com ou sem mesa).
-- ---------------------------------------------------------------------
create function public.create_manual_order(
  p_org_id uuid, p_table_id uuid, p_items jsonb, p_customer_name text, p_notes text, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.can(p_org_id, 'create_manual_order') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_table_id is not null and not exists (
    select 1 from public.tables where id = p_table_id and organization_id = p_org_id and active
  ) then
    raise exception 'table_invalid' using errcode = 'P0001';
  end if;

  v_result := private.place_order(p_org_id, p_table_id, p_items, p_customer_name, p_notes,
    p_idempotency_key, 'staff', (select auth.uid()), 'received');

  if not (v_result ->> 'duplicate')::boolean then
    perform private.write_audit(p_org_id, 'order.manual_created', 'order', v_result ->> 'order_id',
      jsonb_build_object('order_number', v_result -> 'order_number', 'total_cents', v_result -> 'total_cents'));
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Transições de status (validadas no servidor)
-- ---------------------------------------------------------------------
create function private.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('pending_confirmation'::public.order_status, 'received'::public.order_status),
    ('pending_confirmation', 'rejected'),
    ('received', 'preparing'),
    ('received', 'cancelled'),
    ('preparing', 'ready'),
    ('preparing', 'cancelled'),
    ('ready', 'delivered'),
    ('ready', 'cancelled')
  );
$$;

create function public.update_order_status(p_order_id uuid, p_to public.order_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not private.can(v_order.organization_id, 'view_orders') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_to = 'cancelled' and not private.can(v_order.organization_id, 'cancel_orders') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_order.status = p_to then
    return; -- Clique repetido: nada a fazer.
  end if;
  if not private.order_transition_allowed(v_order.status, p_to) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.orders set status = p_to where id = p_order_id;
  insert into public.order_events (organization_id, order_id, actor_user_id, from_status, to_status, note)
  values (v_order.organization_id, p_order_id, (select auth.uid()), v_order.status, p_to,
          nullif(left(trim(coalesce(p_note, '')), 280), ''));

  if p_to in ('cancelled', 'rejected') then
    perform private.write_audit(v_order.organization_id, 'order.' || p_to::text, 'order', p_order_id::text,
      jsonb_build_object('order_number', v_order.order_number, 'from', v_order.status, 'note', p_note));
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Acompanhamento público pelo token do pedido
-- ---------------------------------------------------------------------
create function public.get_order_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number, 'status', o.status, 'payment_status', o.payment_status,
    'subtotal_cents', o.subtotal_cents, 'discount_cents', o.discount_cents, 'total_cents', o.total_cents,
    'customer_name', o.customer_name, 'notes', o.notes, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'organization', jsonb_build_object('name', org.name, 'slug', org.slug),
    'table_name', t.name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.product_name_snapshot, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents,
        'line_total_cents', i.line_total_cents, 'notes', i.notes,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object('option', op.option_name_snapshot, 'item', op.item_name_snapshot,
            'price_cents', op.price_cents))
          from public.order_item_options op where op.order_item_id = i.id
        ), '[]'::jsonb)
      ) order by i.sort_order)
      from public.order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.organizations org on org.id = o.organization_id
  left join public.tables t on t.id = o.table_id
  where o.public_token = p_token;
$$;

revoke all on function private.place_order(uuid, uuid, jsonb, text, text, uuid, public.order_source, uuid, public.order_status)
  from public, anon, authenticated;
revoke all on function public.create_customer_order(text, jsonb, text, text, uuid) from public;
revoke all on function public.create_manual_order(uuid, uuid, jsonb, text, text, uuid) from public, anon;
revoke all on function public.update_order_status(uuid, public.order_status, text) from public, anon;
revoke all on function public.get_order_by_token(text) from public;

grant execute on function public.create_customer_order(text, jsonb, text, text, uuid) to anon, authenticated;
grant execute on function public.create_manual_order(uuid, uuid, jsonb, text, text, uuid) to authenticated;
grant execute on function public.update_order_status(uuid, public.order_status, text) to authenticated;
grant execute on function public.get_order_by_token(text) to anon, authenticated;
