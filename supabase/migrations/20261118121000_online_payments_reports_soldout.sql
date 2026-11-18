-- =====================================================================
-- Pagamentos online (Pagar.me, split por estabelecimento), recebimentos no
-- relatório e esgotado "só hoje".
-- =====================================================================

-- ---------------------------------------------------------------------
-- Esgotado "só hoje": volta sozinho na virada do dia (fuso do estabelecimento).
-- sold_out_until = último dia em que vale; null = até alguém reativar.
-- ---------------------------------------------------------------------
alter table public.products add column sold_out_until date;

create function private.business_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Bahia')::date;
$$;

create function private.is_sold_out(p_sold_out boolean, p_until date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_sold_out and (p_until is null or p_until >= private.business_today());
$$;

drop function public.set_product_sold_out(uuid, boolean);
create function public.set_product_sold_out(p_product_id uuid, p_sold_out boolean, p_only_today boolean default true)
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
  update public.products
  set sold_out = p_sold_out,
      sold_out_until = case when p_sold_out and p_only_today then private.business_today() end
  where id = p_product_id;
end;
$$;

create or replace function private.reject_sold_out_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.products
  where id = new.product_id and private.is_sold_out(sold_out, sold_out_until);
  if v_name is not null then
    raise exception 'product_sold_out' using errcode = 'P0001', detail = v_name;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Configuração de pagamento online por estabelecimento (somente Admin Geral)
-- ---------------------------------------------------------------------
create table public.organization_payment_settings (
  organization_id        uuid primary key references public.organizations (id) on delete cascade,
  enabled                boolean not null default false,
  -- Recebedor do estabelecimento no Pagar.me (split): recebe o valor do pagamento.
  pagarme_recipient_id   text check (pagarme_recipient_id ~ '^rp_[A-Za-z0-9]+$'),
  -- Comissão da PedeAe sobre cada pagamento online (inteiro, %).
  platform_fee_percent   integer not null default 0 check (platform_fee_percent between 0 and 20),
  updated_at             timestamptz not null default now(),
  check (not enabled or pagarme_recipient_id is not null)
);
create trigger organization_payment_settings_updated_at before update on public.organization_payment_settings
  for each row execute function private.set_updated_at();

alter table public.organization_payment_settings enable row level security;
revoke all on public.organization_payment_settings from anon, authenticated;
grant select on public.organization_payment_settings to authenticated;
create policy organization_payment_settings_select on public.organization_payment_settings for select to authenticated
  using (private.is_platform_admin() or private.has_org_role(organization_id));

create function private.online_payments_enabled(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled and pagarme_recipient_id is not null
                   from public.organization_payment_settings where organization_id = p_org_id), false);
$$;

create function public.platform_set_payment_settings(
  p_org_id uuid, p_enabled boolean, p_recipient_id text, p_platform_fee_percent integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.organization_payment_settings (organization_id, enabled, pagarme_recipient_id, platform_fee_percent)
  values (p_org_id, p_enabled, nullif(trim(p_recipient_id), ''), p_platform_fee_percent)
  on conflict (organization_id) do update
  set enabled = excluded.enabled, pagarme_recipient_id = excluded.pagarme_recipient_id,
      platform_fee_percent = excluded.platform_fee_percent;
  perform private.write_audit(p_org_id, 'payments.settings_updated', 'organization', p_org_id::text,
    jsonb_build_object('enabled', p_enabled, 'platform_fee_percent', p_platform_fee_percent));
end;
$$;

-- ---------------------------------------------------------------------
-- Intenções de pagamento: uma por pagamento online (conta da mesa, pedido
-- antecipado ou link enviado pela equipe). O cliente paga em /pagar/<token>.
-- ---------------------------------------------------------------------
create table public.payment_intents (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  public_token        text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  kind                text not null check (kind in ('tab', 'order')),
  table_session_id    uuid,
  order_id            uuid,
  amount_cents        bigint not null check (amount_cents between 100 and 100000000),
  service_fee_percent numeric(5, 2) not null default 0,
  status              text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  method              text check (method in ('pix', 'credit_card')),
  provider            text not null default 'pagarme',
  provider_order_id   text,
  pix_qr_code         text,
  pix_qr_code_url     text,
  pix_expires_at      timestamptz,
  failure_reason      text,
  source              text not null check (source in ('customer', 'staff_link')),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '30 minutes',
  paid_at             timestamptz,
  foreign key (organization_id, table_session_id) references public.table_sessions (organization_id, id) on delete restrict,
  foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete restrict,
  check ((kind = 'tab' and table_session_id is not null and order_id is null) or (kind = 'order' and order_id is not null))
);
create index payment_intents_org_idx on public.payment_intents (organization_id, created_at desc);
create index payment_intents_session_idx on public.payment_intents (table_session_id) where table_session_id is not null;
create unique index payment_intents_provider_idx on public.payment_intents (provider_order_id) where provider_order_id is not null;

alter table public.payment_intents enable row level security;
revoke all on public.payment_intents from anon, authenticated;
grant select on public.payment_intents to authenticated;
create policy payment_intents_select on public.payment_intents for select to authenticated
  using (private.can(organization_id, 'view_orders'));

-- Pagamento confirmado entra na conta da mesa uma vez só.
alter table public.tab_payments add column payment_intent_id uuid unique references public.payment_intents (id) on delete restrict;

-- Pedidos aguardando pagamento não contam na conta nem a travam.
create or replace function private.tab_totals(p_session_id uuid, p_fee_percent numeric)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select
      coalesce((select sum(total_cents) from public.orders where table_session_id = p_session_id
        and status not in ('cancelled', 'rejected', 'awaiting_payment')), 0) as subtotal,
      coalesce((select sum(amount_cents) from public.tab_payments where table_session_id = p_session_id), 0) as paid
  )
  select jsonb_build_object(
    'subtotal_cents', subtotal,
    'service_fee_cents', round(subtotal * p_fee_percent / 100.0)::bigint,
    'total_cents', subtotal + round(subtotal * p_fee_percent / 100.0)::bigint,
    'paid_cents', paid)
  from t;
$$;

create or replace function public.close_tab(p_session_id uuid, p_service_fee_percent numeric)
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
  -- Pedidos antecipados que nunca foram pagos são cancelados com a conta.
  update public.orders set status = 'cancelled'
  where table_session_id = p_session_id and status = 'awaiting_payment';
  update public.payment_intents set status = 'cancelled'
  where table_session_id = p_session_id and status = 'pending';

  perform private.write_audit(v_s.organization_id, 'tab.closed', 'table_session', v_s.id::text, v_t);
  return v_t;
end;
$$;

/** Quanto falta pagar na conta, com a taxa informada (pagamentos online usam a do cliente). */
create function private.tab_remaining(p_session_id uuid, p_fee_percent numeric)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, (t ->> 'total_cents')::bigint - (t ->> 'paid_cents')::bigint)
  from private.tab_totals(p_session_id, p_fee_percent) t;
$$;

/** Cliente pela mesa: paga a conta toda (p_amount_cents null) ou uma parte. */
create function public.create_tab_payment_intent(p_table_token text, p_amount_cents bigint, p_include_service_fee boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table record;
  v_session_id uuid;
  v_fee numeric := case when p_include_service_fee then 10 else 0 end;
  v_remaining bigint;
  v_amount bigint;
  v_intent public.payment_intents;
begin
  select t.id, t.organization_id into v_table
  from public.table_qr_codes q
  join public.tables t on t.id = q.table_id
  join public.organizations o on o.id = q.organization_id
  where q.token = p_table_token and q.revoked_at is null and t.active and o.status = 'active';
  if v_table.id is null then
    raise exception 'table_invalid' using errcode = 'P0001';
  end if;
  if not private.online_payments_enabled(v_table.organization_id) then
    raise exception 'online_payments_disabled' using errcode = 'P0001';
  end if;

  select id into v_session_id from public.table_sessions where table_id = v_table.id and status = 'open';
  if v_session_id is null then
    raise exception 'tab_empty' using errcode = 'P0001';
  end if;
  v_remaining := private.tab_remaining(v_session_id, v_fee);
  if v_remaining < 100 then
    raise exception 'tab_empty' using errcode = 'P0001';
  end if;
  v_amount := coalesce(p_amount_cents, v_remaining);
  if v_amount < 100 or v_amount > v_remaining then
    raise exception 'invalid_amount' using errcode = 'P0001', detail = v_remaining::text;
  end if;

  insert into public.payment_intents (organization_id, kind, table_session_id, amount_cents, service_fee_percent, source)
  values (v_table.organization_id, 'tab', v_session_id, v_amount, v_fee, 'customer')
  returning * into v_intent;
  return jsonb_build_object('token', v_intent.public_token, 'amount_cents', v_amount);
end;
$$;

/** Equipe gera um link para a pessoa pagar de onde estiver (WhatsApp etc.). Vale 24 h. */
create function public.create_tab_payment_link(p_session_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.table_sessions;
  v_remaining bigint;
  v_intent public.payment_intents;
begin
  select * into v_s from public.table_sessions where id = p_session_id;
  if v_s.id is null or not private.can(v_s.organization_id, 'receive_payments') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_s.status <> 'open' then
    raise exception 'tab_closed' using errcode = 'P0001';
  end if;
  if not private.online_payments_enabled(v_s.organization_id) then
    raise exception 'online_payments_disabled' using errcode = 'P0001';
  end if;
  -- O valor vem pronto do painel (já com a taxa escolhida pela equipe), limitado ao consumo + 30%.
  v_remaining := private.tab_remaining(p_session_id, 30);
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > v_remaining then
    raise exception 'invalid_amount' using errcode = 'P0001', detail = v_remaining::text;
  end if;

  insert into public.payment_intents (organization_id, kind, table_session_id, amount_cents, source, created_by, expires_at)
  values (v_s.organization_id, 'tab', v_s.id, p_amount_cents, 'staff_link', (select auth.uid()), now() + interval '24 hours')
  returning * into v_intent;
  return jsonb_build_object('token', v_intent.public_token, 'amount_cents', p_amount_cents);
end;
$$;

/** Dados públicos da página de pagamento. Pendente vencido aparece como expirado. */
create function public.get_payment_intent(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'kind', i.kind,
    'amount_cents', i.amount_cents,
    'status', case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
    'method', i.method,
    'expires_at', i.expires_at,
    'pix_qr_code', i.pix_qr_code,
    'pix_qr_code_url', i.pix_qr_code_url,
    'pix_expires_at', i.pix_expires_at,
    'failure_reason', i.failure_reason,
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug),
    'table_name', coalesce(tb.name, otb.name),
    'order', case when ord.id is not null then jsonb_build_object(
      'number', ord.order_number, 'public_token', ord.public_token, 'status', ord.status) end
  )
  from public.payment_intents i
  join public.organizations o on o.id = i.organization_id
  left join public.table_sessions ts on ts.id = i.table_session_id
  left join public.tables tb on tb.id = ts.table_id
  left join public.orders ord on ord.id = i.order_id
  left join public.tables otb on otb.id = ord.table_id
  where i.public_token = p_token;
$$;

/**
 * Confirmação vinda do servidor depois de consultar o Pagar.me (webhook ou verificação ativa).
 * Idempotente. Somente o papel de serviço (servidor) executa.
 */
create function public.confirm_payment_intent(p_intent_id uuid, p_method text, p_provider_order_id text, p_paid_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payment_intents;
  v_order public.orders;
  v_settings jsonb;
  v_session uuid;
  v_status public.order_status;
begin
  select * into v_i from public.payment_intents where id = p_intent_id for update;
  if v_i.id is null then
    raise exception 'intent_not_found' using errcode = 'P0001';
  end if;
  if v_i.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'duplicate', true);
  end if;
  if p_paid_amount_cents < v_i.amount_cents then
    raise exception 'amount_mismatch' using errcode = 'P0001';
  end if;

  update public.payment_intents
  set status = 'paid', paid_at = now(), method = p_method,
      provider_order_id = coalesce(provider_order_id, p_provider_order_id)
  where id = v_i.id;

  if v_i.kind = 'order' then
    select * into v_order from public.orders where id = v_i.order_id for update;
    v_session := v_order.table_session_id;
    if v_order.status = 'awaiting_payment' then
      select settings into v_settings from public.organization_settings where organization_id = v_order.organization_id;
      v_status := case when coalesce((v_settings ->> 'require_order_confirmation')::boolean, false)
                       then 'pending_confirmation' else 'received' end;
      update public.orders set status = v_status, payment_status = 'paid' where id = v_order.id;
      insert into public.order_events (organization_id, order_id, actor_user_id, from_status, to_status, note)
      values (v_order.organization_id, v_order.id, null, 'awaiting_payment', v_status, 'Pago online');
    else
      update public.orders set payment_status = 'paid' where id = v_order.id;
    end if;
  else
    v_session := v_i.table_session_id;
  end if;

  -- O valor pago entra na conta da mesa (pedido antecipado de mesa ou pagamento da conta).
  if v_session is not null then
    insert into public.tab_payments (organization_id, table_session_id, amount_cents, method, received_by, payment_intent_id)
    values (v_i.organization_id, v_session, v_i.amount_cents,
            case when p_method = 'credit_card' then 'credito' else 'pix' end, null, v_i.id)
    on conflict (payment_intent_id) do nothing;
  end if;

  perform private.write_audit(v_i.organization_id, 'payment.online_confirmed', 'payment_intent', v_i.id::text,
    jsonb_build_object('amount_cents', v_i.amount_cents, 'method', p_method, 'kind', v_i.kind));
  return jsonb_build_object('status', 'paid', 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------
-- Pedido do cliente pode ser pago antes (vai para a fila só depois de pago).
-- ---------------------------------------------------------------------
drop function public.create_customer_order(text, jsonb, text, text, uuid, text);
create function public.create_customer_order(
  p_table_token text, p_items jsonb, p_customer_name text, p_notes text, p_idempotency_key uuid,
  p_coupon_code text default null, p_prepay boolean default false
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
  v_intent public.payment_intents;
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

  -- Reenvio com a mesma chave: devolve o pedido existente (e a intenção de pagamento, se houver).
  select jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'public_token', o.public_token,
    'status', o.status, 'total_cents', o.total_cents, 'duplicate', true,
    'payment_token', (select i.public_token from public.payment_intents i where i.order_id = o.id order by i.created_at desc limit 1))
  into v_existing
  from public.orders o where o.organization_id = v_table.organization_id and o.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_prepay and not private.online_payments_enabled(v_table.organization_id) then
    raise exception 'online_payments_disabled' using errcode = 'P0001';
  end if;

  -- Limite simples contra abuso: até 6 pedidos de cliente por mesa a cada 5 minutos.
  select count(*) into v_recent from public.orders
  where table_id = v_table.table_id and source = 'customer' and created_at > now() - interval '5 minutes';
  if v_recent >= 6 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Antecipados abandonados (pagamento vencido) são cancelados.
  update public.orders o set status = 'cancelled'
  where o.organization_id = v_table.organization_id and o.status = 'awaiting_payment'
    and not exists (select 1 from public.payment_intents i where i.order_id = o.id and i.status = 'pending' and i.expires_at > now());

  v_status := case
    when p_prepay then 'awaiting_payment'
    when coalesce((v_table.settings ->> 'require_order_confirmation')::boolean, false) then 'pending_confirmation'
    else 'received' end;

  v_result := private.place_order(v_table.organization_id, v_table.table_id, p_items, p_customer_name, p_notes,
    p_idempotency_key, 'customer', null, v_status);

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    v_coupon := private.apply_coupon_to_order((v_result ->> 'order_id')::uuid, p_coupon_code);
    v_result := v_result || jsonb_build_object(
      'total_cents', (v_result ->> 'total_cents')::bigint - (v_coupon ->> 'discount_cents')::bigint,
      'discount_cents', v_coupon -> 'discount_cents');
  end if;

  if p_prepay then
    if (v_result ->> 'total_cents')::bigint < 100 then
      raise exception 'invalid_amount' using errcode = 'P0001';
    end if;
    insert into public.payment_intents (organization_id, kind, order_id, amount_cents, source)
    values (v_table.organization_id, 'order', (v_result ->> 'order_id')::uuid, (v_result ->> 'total_cents')::bigint, 'customer')
    returning * into v_intent;
    v_result := v_result || jsonb_build_object('payment_token', v_intent.public_token);
  end if;
  return v_result;
end;
$$;

-- Cancelar um antecipado não pago também é permitido (equipe).
create or replace function private.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('awaiting_payment'::public.order_status, 'cancelled'::public.order_status),
    ('pending_confirmation', 'received'),
    ('pending_confirmation', 'rejected'),
    ('received', 'preparing'),
    ('received', 'cancelled'),
    ('preparing', 'ready'),
    ('preparing', 'cancelled'),
    ('ready', 'delivered'),
    ('ready', 'cancelled')
  );
$$;

-- Total da mesa para "Pedir a conta" ignora antecipados não pagos.
create or replace function public.call_service(p_table_token text, p_kind text)
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
    update public.service_calls set created_at = now() where id = v_call.id returning * into v_call;
  end if;

  select coalesce(sum(o.total_cents), 0) into v_total
  from public.orders o join public.table_sessions ts on ts.id = o.table_session_id
  where ts.table_id = v_table.id and ts.status = 'open' and o.status not in ('cancelled', 'rejected', 'awaiting_payment');

  return jsonb_build_object('kind', p_kind, 'tab_total_cents', v_total);
end;
$$;

-- Cardápio público: esgotado efetivo (respeita "só hoje") e se aceita pagamento online.
create or replace function public.get_public_menu(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug),
    'online_payments', private.online_payments_enabled(o.id),
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
            'sold_out', private.is_sold_out(p.sold_out, p.sold_out_until),
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
          ) order by private.is_sold_out(p.sold_out, p.sold_out_until), p.sort_order, p.name)
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
-- 4. Recebimentos por forma de pagamento (fechamento de caixa)
-- ---------------------------------------------------------------------
create function public.report_payments(p_org_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz constant text := 'America/Bahia';
  v_start timestamptz;
  v_end timestamptz;
begin
  if not private.can(p_org_id, 'view_reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  return jsonb_build_object(
    'total_cents', (
      select coalesce(sum(amount_cents), 0) from public.tab_payments
      where organization_id = p_org_id and created_at >= v_start and created_at < v_end),
    'by_method', (
      select coalesce(jsonb_agg(t order by t.amount_cents desc), '[]'::jsonb) from (
        select method, count(*) as count, sum(amount_cents) as amount_cents,
               sum(amount_cents) filter (where payment_intent_id is not null) as online_cents
        from public.tab_payments
        where organization_id = p_org_id and created_at >= v_start and created_at < v_end
        group by method) t),
    'by_person', (
      select coalesce(jsonb_agg(t order by t.amount_cents desc), '[]'::jsonb) from (
        select case when tp.payment_intent_id is not null then 'Pagamento online'
                    else coalesce(nullif(p.name, ''), p.email, 'Equipe') end as name,
               count(*) as count, sum(tp.amount_cents) as amount_cents
        from public.tab_payments tp left join public.profiles p on p.id = tp.received_by
        where tp.organization_id = p_org_id and tp.created_at >= v_start and tp.created_at < v_end
        group by 1) t),
    'by_day', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'amount_cents', coalesce(x.amount, 0)) order by d.day)
      from (select generate_series(p_from, p_to, interval '1 day')::date as day) d
      left join (
        select (created_at at time zone v_tz)::date as day, sum(amount_cents) as amount
        from public.tab_payments where organization_id = p_org_id and created_at >= v_start and created_at < v_end
        group by 1) x on x.day = d.day),
    'service_fee_cents', (
      select coalesce(sum(service_fee_cents), 0) from public.table_sessions
      where organization_id = p_org_id and status = 'closed' and closed_at >= v_start and closed_at < v_end),
    'tabs_closed', (
      select count(*) from public.table_sessions
      where organization_id = p_org_id and status = 'closed' and closed_at >= v_start and closed_at < v_end)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------
revoke all on function public.set_product_sold_out(uuid, boolean, boolean) from public, anon;
revoke all on function public.platform_set_payment_settings(uuid, boolean, text, integer) from public, anon;
revoke all on function public.create_tab_payment_intent(text, bigint, boolean) from public;
revoke all on function public.create_tab_payment_link(uuid, bigint) from public, anon;
revoke all on function public.get_payment_intent(text) from public;
revoke all on function public.confirm_payment_intent(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.create_customer_order(text, jsonb, text, text, uuid, text, boolean) from public;
revoke all on function public.report_payments(uuid, date, date) from public, anon;
revoke all on function private.online_payments_enabled(uuid) from public, anon, authenticated;
revoke all on function private.tab_remaining(uuid, numeric) from public, anon, authenticated;

grant execute on function public.set_product_sold_out(uuid, boolean, boolean) to authenticated;
grant execute on function public.platform_set_payment_settings(uuid, boolean, text, integer) to authenticated;
grant execute on function public.create_tab_payment_intent(text, bigint, boolean) to anon, authenticated;
grant execute on function public.create_tab_payment_link(uuid, bigint) to authenticated;
grant execute on function public.get_payment_intent(text) to anon, authenticated;
grant execute on function public.confirm_payment_intent(uuid, text, text, bigint) to service_role;
grant execute on function public.create_customer_order(text, jsonb, text, text, uuid, text, boolean) to anon, authenticated;
grant execute on function public.report_payments(uuid, date, date) to authenticated;
