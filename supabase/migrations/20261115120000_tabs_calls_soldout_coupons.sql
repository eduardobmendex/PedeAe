-- =====================================================================
-- Salão: conta da mesa, chamar garçom / pedir a conta, esgotado e cupons.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4. Esgotado com um toque
--
-- Separado de `available`: `available = false` esconde o produto (ex.: troca de tipo do
-- cardápio); `sold_out = true` mantém o produto visível como "Esgotado" e bloqueia o pedido.
-- Qualquer pessoa da equipe que vê pedidos pode marcar (a cozinha é quem sabe o que acabou).
-- ---------------------------------------------------------------------
alter table public.products add column sold_out boolean not null default false;

create function public.set_product_sold_out(p_product_id uuid, p_sold_out boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.products where id = p_product_id;
  if v_org is null or not private.can(v_org, 'view_orders') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.products set sold_out = p_sold_out where id = p_product_id;
end;
$$;

-- Pedido de produto esgotado é recusado (vale para cliente e equipe).
create function private.reject_sold_out_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.products where id = new.product_id and sold_out;
  if v_name is not null then
    raise exception 'product_sold_out' using errcode = 'P0001', detail = v_name;
  end if;
  return new;
end;
$$;

create trigger order_items_sold_out before insert on public.order_items
  for each row execute function private.reject_sold_out_item();

-- Cardápio público passa a informar `sold_out`.
create or replace function public.get_public_menu(p_slug text)
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
            'image_path', p.image_path, 'featured', p.featured, 'sold_out', p.sold_out,
            'options', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', po.id, 'name', po.name, 'min_select', po.min_select, 'max_select', po.max_select,
                'price_rule', po.price_rule,
                'items', coalesce((
                  select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'price_delta_cents', i.price_delta_cents)
                    order by i.sort_order)
                  from public.product_option_items i where i.option_id = po.id and i.available
                ), '[]'::jsonb)
              ) order by po.sort_order)
              from public.product_options po where po.product_id = p.id
            ), '[]'::jsonb)
          ) order by p.sold_out, p.sort_order, p.name)
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

-- ---------------------------------------------------------------------
-- 5. Cupons
--
-- Usos contam pedidos não cancelados/recusados com o cupom: cancelar devolve o uso.
-- ---------------------------------------------------------------------
create table public.coupons (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  code             text not null check (code ~ '^[A-Z0-9_-]{3,20}$'),
  description      text check (char_length(description) <= 120),
  kind             text not null check (kind in ('percent', 'fixed')),
  value            bigint not null check (value > 0),
  min_order_cents  bigint not null default 0 check (min_order_cents >= 0),
  max_uses         integer check (max_uses > 0),
  valid_from       date,
  valid_until      date,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code),
  check (kind <> 'percent' or value <= 100),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create trigger coupons_updated_at before update on public.coupons
  for each row execute function private.set_updated_at();
create trigger coupons_audit after insert or update or delete on public.coupons
  for each row execute function private.audit_row_change();

alter table public.coupons enable row level security;
revoke all on public.coupons from anon, authenticated;
grant select, insert, update, delete on public.coupons to authenticated;
create policy coupons_select on public.coupons for select to authenticated
  using (private.can(organization_id, 'manage_coupons') or private.can(organization_id, 'apply_coupons'));
create policy coupons_insert on public.coupons for insert to authenticated
  with check (private.can(organization_id, 'manage_coupons'));
create policy coupons_update on public.coupons for update to authenticated
  using (private.can(organization_id, 'manage_coupons')) with check (private.can(organization_id, 'manage_coupons'));
create policy coupons_delete on public.coupons for delete to authenticated
  using (private.can(organization_id, 'manage_coupons'));

alter table public.orders add column coupon_id uuid references public.coupons (id) on delete set null;
alter table public.orders add column coupon_code text;
create index orders_coupon_idx on public.orders (coupon_id) where coupon_id is not null;

/** Valida o cupom para um subtotal e devolve {coupon_id, code, discount_cents}. Trava o cupom (concorrência de usos). */
create function private.evaluate_coupon(p_org_id uuid, p_code text, p_subtotal bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.coupons;
  v_today date := (now() at time zone 'America/Bahia')::date;
  v_used int;
  v_discount bigint;
begin
  select * into v_c from public.coupons
  where organization_id = p_org_id and code = upper(trim(p_code)) and active
  for update;
  if v_c.id is null then
    raise exception 'coupon_invalid' using errcode = 'P0001';
  end if;
  if (v_c.valid_from is not null and v_today < v_c.valid_from) or (v_c.valid_until is not null and v_today > v_c.valid_until) then
    raise exception 'coupon_expired' using errcode = 'P0001';
  end if;
  if v_c.max_uses is not null then
    select count(*) into v_used from public.orders
    where coupon_id = v_c.id and status not in ('cancelled', 'rejected');
    if v_used >= v_c.max_uses then
      raise exception 'coupon_exhausted' using errcode = 'P0001';
    end if;
  end if;
  if p_subtotal < v_c.min_order_cents then
    raise exception 'coupon_min_order' using errcode = 'P0001', detail = v_c.min_order_cents::text;
  end if;

  v_discount := case v_c.kind
    when 'percent' then round(p_subtotal * v_c.value / 100.0)::bigint
    else least(v_c.value, p_subtotal)
  end;
  return jsonb_build_object('coupon_id', v_c.id, 'code', v_c.code, 'discount_cents', v_discount,
    'kind', v_c.kind, 'value', v_c.value, 'description', v_c.description);
end;
$$;

/** Aplica o cupom num pedido recém-criado (mesma transação). */
create function private.apply_coupon_to_order(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders;
  v_c jsonb;
begin
  select * into v_o from public.orders where id = p_order_id;
  v_c := private.evaluate_coupon(v_o.organization_id, p_code, v_o.subtotal_cents);
  update public.orders
  set discount_cents = (v_c ->> 'discount_cents')::bigint,
      total_cents = subtotal_cents - (v_c ->> 'discount_cents')::bigint,
      coupon_id = (v_c ->> 'coupon_id')::uuid,
      coupon_code = v_c ->> 'code'
  where id = p_order_id;
  return v_c;
end;
$$;

/** Prévia para o carrinho (cliente pela mesa). O valor final é sempre recalculado no pedido. */
create function public.check_coupon(p_table_token text, p_code text, p_subtotal_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_c jsonb;
begin
  select q.organization_id into v_org
  from public.table_qr_codes q join public.organizations o on o.id = q.organization_id
  where q.token = p_table_token and q.revoked_at is null and o.status = 'active';
  if v_org is null then
    raise exception 'table_invalid' using errcode = 'P0001';
  end if;
  v_c := private.evaluate_coupon(v_org, p_code, greatest(coalesce(p_subtotal_cents, 0), 0));
  return v_c - 'coupon_id';
end;
$$;

-- Pedido do cliente e pedido manual passam a aceitar cupom.
drop function public.create_customer_order(text, jsonb, text, text, uuid);
create function public.create_customer_order(
  p_table_token text, p_items jsonb, p_customer_name text, p_notes text, p_idempotency_key uuid,
  p_coupon_code text default null
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
  v_result jsonb;
  v_coupon jsonb;
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

  v_result := private.place_order(v_table.organization_id, v_table.table_id, p_items, p_customer_name, p_notes,
    p_idempotency_key, 'customer', null, v_status);

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    v_coupon := private.apply_coupon_to_order((v_result ->> 'order_id')::uuid, p_coupon_code);
    v_result := v_result || jsonb_build_object(
      'total_cents', (v_result ->> 'total_cents')::bigint - (v_coupon ->> 'discount_cents')::bigint,
      'discount_cents', v_coupon -> 'discount_cents');
  end if;
  return v_result;
end;
$$;

drop function public.create_manual_order(uuid, uuid, jsonb, text, text, uuid);
create function public.create_manual_order(
  p_org_id uuid, p_table_id uuid, p_items jsonb, p_customer_name text, p_notes text, p_idempotency_key uuid,
  p_coupon_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_coupon jsonb;
  v_has_coupon boolean := nullif(trim(coalesce(p_coupon_code, '')), '') is not null;
begin
  if not private.can(p_org_id, 'create_manual_order') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_has_coupon and not private.can(p_org_id, 'apply_coupons') then
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
    if v_has_coupon then
      v_coupon := private.apply_coupon_to_order((v_result ->> 'order_id')::uuid, p_coupon_code);
      v_result := v_result || jsonb_build_object(
        'total_cents', (v_result ->> 'total_cents')::bigint - (v_coupon ->> 'discount_cents')::bigint,
        'discount_cents', v_coupon -> 'discount_cents');
    end if;
    perform private.write_audit(p_org_id, 'order.manual_created', 'order', v_result ->> 'order_id',
      jsonb_build_object('order_number', v_result -> 'order_number', 'total_cents', v_result -> 'total_cents',
        'coupon', v_coupon -> 'code'));
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Chamar garçom / pedir a conta
-- ---------------------------------------------------------------------
create table public.service_calls (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  table_id          uuid not null,
  kind              text not null check (kind in ('waiter', 'bill')),
  status            text not null default 'open' check (status in ('open', 'done')),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       uuid references auth.users (id) on delete set null,
  foreign key (organization_id, table_id) references public.tables (organization_id, id) on delete cascade
);
create index service_calls_open_idx on public.service_calls (organization_id, created_at) where status = 'open';
create unique index service_calls_one_open_idx on public.service_calls (table_id, kind) where status = 'open';

alter table public.service_calls enable row level security;
revoke all on public.service_calls from anon, authenticated;
grant select on public.service_calls to authenticated;
create policy service_calls_select on public.service_calls for select to authenticated
  using (private.can(organization_id, 'view_orders'));

/**
 * Cliente chama pela mesa. Chamado do mesmo tipo já aberto não duplica (só "reavisa" após 2 min).
 * Pedir a conta devolve o total da mesa até agora.
 */
create function public.call_service(p_table_token text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_call public.service_calls;
  v_total bigint;
begin
  if p_kind not in ('waiter', 'bill') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  select t.id, t.organization_id into v_table
  from public.table_qr_codes q
  join public.tables t on t.id = q.table_id
  join public.organizations o on o.id = q.organization_id
  where q.token = p_table_token and q.revoked_at is null and t.active and o.status = 'active';
  if v_table.id is null then
    raise exception 'table_invalid' using errcode = 'P0001';
  end if;

  select * into v_call from public.service_calls where table_id = v_table.id and kind = p_kind and status = 'open';
  if v_call.id is null then
    insert into public.service_calls (organization_id, table_id, kind)
    values (v_table.organization_id, v_table.id, p_kind)
    on conflict do nothing
    returning * into v_call;
  elsif v_call.created_at < now() - interval '2 minutes' then
    -- Reaviso: renova o horário para o painel tocar de novo.
    update public.service_calls set created_at = now() where id = v_call.id returning * into v_call;
  end if;

  select coalesce(sum(o.total_cents), 0) into v_total
  from public.orders o join public.table_sessions ts on ts.id = o.table_session_id
  where ts.table_id = v_table.id and ts.status = 'open' and o.status not in ('cancelled', 'rejected');

  return jsonb_build_object('kind', p_kind, 'tab_total_cents', v_total);
end;
$$;

create function public.resolve_service_call(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.service_calls where id = p_call_id;
  if v_org is null or not private.can(v_org, 'view_orders') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.service_calls set status = 'done', resolved_at = now(), resolved_by = (select auth.uid())
  where id = p_call_id and status = 'open';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'service_calls') then
    alter publication supabase_realtime add table public.service_calls;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Conta da mesa
--
-- A sessão da mesa (aberta pelo primeiro pedido) é a conta. Recebe pagamentos parciais
-- (receive_payments) e é fechada com taxa de serviço opcional (close_tabs) quando tudo foi pago
-- e não há pedido em andamento. Fechar libera a mesa: o próximo pedido abre uma conta nova.
-- ---------------------------------------------------------------------
alter table public.table_sessions
  add column service_fee_percent numeric(5, 2) not null default 0 check (service_fee_percent between 0 and 30),
  add column subtotal_cents bigint,
  add column service_fee_cents bigint,
  add column total_cents bigint,
  add column paid_cents bigint;

create table public.tab_payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  table_session_id  uuid not null,
  amount_cents      bigint not null check (amount_cents between 1 and 100000000),
  method            text not null check (method in ('dinheiro', 'credito', 'debito', 'pix')),
  received_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (organization_id, table_session_id) references public.table_sessions (organization_id, id) on delete restrict
);
create index tab_payments_session_idx on public.tab_payments (table_session_id);
create index tab_payments_org_idx on public.tab_payments (organization_id, created_at);

alter table public.tab_payments enable row level security;
revoke all on public.tab_payments from anon, authenticated;
grant select on public.tab_payments to authenticated;
create policy tab_payments_select on public.tab_payments for select to authenticated
  using (private.can(organization_id, 'view_orders'));

/** Totais da conta: pedidos válidos, taxa, pagos e restante. */
create function private.tab_totals(p_session_id uuid, p_fee_percent numeric)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select
      coalesce((select sum(total_cents) from public.orders where table_session_id = p_session_id
        and status not in ('cancelled', 'rejected')), 0) as subtotal,
      coalesce((select sum(amount_cents) from public.tab_payments where table_session_id = p_session_id), 0) as paid
  )
  select jsonb_build_object(
    'subtotal_cents', subtotal,
    'service_fee_cents', round(subtotal * p_fee_percent / 100.0)::bigint,
    'total_cents', subtotal + round(subtotal * p_fee_percent / 100.0)::bigint,
    'paid_cents', paid)
  from t;
$$;

create function public.record_tab_payment(p_session_id uuid, p_amount_cents bigint, p_method text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.table_sessions;
  v_id uuid;
begin
  select * into v_s from public.table_sessions where id = p_session_id for update;
  if v_s.id is null or not private.can(v_s.organization_id, 'receive_payments') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_s.status <> 'open' then
    raise exception 'tab_closed' using errcode = 'P0001';
  end if;
  insert into public.tab_payments (organization_id, table_session_id, amount_cents, method)
  values (v_s.organization_id, v_s.id, p_amount_cents, p_method)
  returning id into v_id;
  perform private.write_audit(v_s.organization_id, 'tab.payment_recorded', 'table_session', v_s.id::text,
    jsonb_build_object('amount_cents', p_amount_cents, 'method', p_method));
  return v_id;
end;
$$;

create function public.delete_tab_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.tab_payments;
  v_status public.table_session_status;
begin
  select * into v_p from public.tab_payments where id = p_payment_id;
  if v_p.id is null or not private.can(v_p.organization_id, 'receive_payments') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.table_sessions where id = v_p.table_session_id for update;
  if v_status <> 'open' then
    raise exception 'tab_closed' using errcode = 'P0001';
  end if;
  delete from public.tab_payments where id = p_payment_id;
  perform private.write_audit(v_p.organization_id, 'tab.payment_deleted', 'table_session', v_p.table_session_id::text,
    jsonb_build_object('amount_cents', v_p.amount_cents, 'method', v_p.method));
end;
$$;

create function public.close_tab(p_session_id uuid, p_service_fee_percent numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.table_sessions;
  v_t jsonb;
begin
  select * into v_s from public.table_sessions where id = p_session_id for update;
  if v_s.id is null or not private.can(v_s.organization_id, 'close_tabs') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_s.status <> 'open' then
    raise exception 'tab_closed' using errcode = 'P0001';
  end if;
  if p_service_fee_percent is null or p_service_fee_percent < 0 or p_service_fee_percent > 30 then
    raise exception 'invalid_fee' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.orders where table_session_id = p_session_id
      and status in ('pending_confirmation', 'received', 'preparing', 'ready')
  ) then
    raise exception 'tab_has_active_orders' using errcode = 'P0001';
  end if;

  v_t := private.tab_totals(p_session_id, p_service_fee_percent);
  if (v_t ->> 'paid_cents')::bigint < (v_t ->> 'total_cents')::bigint then
    raise exception 'tab_not_paid' using errcode = 'P0001',
      detail = ((v_t ->> 'total_cents')::bigint - (v_t ->> 'paid_cents')::bigint)::text;
  end if;

  update public.table_sessions
  set status = 'closed', closed_at = now(), closed_by = (select auth.uid()),
      service_fee_percent = p_service_fee_percent,
      subtotal_cents = (v_t ->> 'subtotal_cents')::bigint,
      service_fee_cents = (v_t ->> 'service_fee_cents')::bigint,
      total_cents = (v_t ->> 'total_cents')::bigint,
      paid_cents = (v_t ->> 'paid_cents')::bigint
  where id = p_session_id;

  update public.orders set payment_status = 'paid'
  where table_session_id = p_session_id and status = 'delivered';

  perform private.write_audit(v_s.organization_id, 'tab.closed', 'table_session', v_s.id::text, v_t);
  return v_t;
end;
$$;

-- Ao fechar a conta, chamados abertos da mesa são resolvidos.
create function private.resolve_calls_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status = 'open' then
    update public.service_calls set status = 'done', resolved_at = now(), resolved_by = new.closed_by
    where table_id = new.table_id and status = 'open';
  end if;
  return new;
end;
$$;

create trigger table_sessions_close_calls after update on public.table_sessions
  for each row execute function private.resolve_calls_on_close();

-- ---------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public.set_product_sold_out(uuid, boolean) from public, anon;
revoke all on function public.check_coupon(text, text, bigint) from public;
revoke all on function public.create_customer_order(text, jsonb, text, text, uuid, text) from public;
revoke all on function public.create_manual_order(uuid, uuid, jsonb, text, text, uuid, text) from public, anon;
revoke all on function public.call_service(text, text) from public;
revoke all on function public.resolve_service_call(uuid) from public, anon;
revoke all on function public.record_tab_payment(uuid, bigint, text) from public, anon;
revoke all on function public.delete_tab_payment(uuid) from public, anon;
revoke all on function public.close_tab(uuid, numeric) from public, anon;
revoke all on function private.evaluate_coupon(uuid, text, bigint) from public, anon, authenticated;
revoke all on function private.apply_coupon_to_order(uuid, text) from public, anon, authenticated;
revoke all on function private.tab_totals(uuid, numeric) from public, anon, authenticated;

grant execute on function public.set_product_sold_out(uuid, boolean) to authenticated;
grant execute on function public.check_coupon(text, text, bigint) to anon, authenticated;
grant execute on function public.create_customer_order(text, jsonb, text, text, uuid, text) to anon, authenticated;
grant execute on function public.create_manual_order(uuid, uuid, jsonb, text, text, uuid, text) to authenticated;
grant execute on function public.call_service(text, text) to anon, authenticated;
grant execute on function public.resolve_service_call(uuid) to authenticated;
grant execute on function public.record_tab_payment(uuid, bigint, text) to authenticated;
grant execute on function public.delete_tab_payment(uuid) to authenticated;
grant execute on function public.close_tab(uuid, numeric) to authenticated;
