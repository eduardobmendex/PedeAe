-- =====================================================================
-- Gestão: relatórios de vendas, cobrança do SaaS e visão geral da plataforma.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Relatório de vendas (permissão view_reports)
--
-- Vendas = pedidos aceitos (recebido, em preparo, pronto, entregue).
-- "Aguardando confirmação" ainda não é venda; cancelados/recusados aparecem à parte.
-- Dias e horas no fuso do estabelecimento (America/Bahia, igual ao painel).
-- ---------------------------------------------------------------------
create function public.report_sales(p_org_id uuid, p_from date, p_to date)
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
  v_result jsonb;
begin
  if not private.can(p_org_id, 'view_reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;

  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  with period as (
    select o.* from public.orders o
    where o.organization_id = p_org_id and o.created_at >= v_start and o.created_at < v_end
  ),
  sales as (
    select * from period where status in ('received', 'preparing', 'ready', 'delivered')
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders', count(*),
        'revenue_cents', coalesce(sum(total_cents), 0),
        'avg_ticket_cents', coalesce(round(avg(total_cents)), 0),
        'items_sold', coalesce((
          select sum(i.quantity) from public.order_items i where i.order_id in (select id from sales)
        ), 0)
      )
      from sales
    ),
    'cancelled', (
      select jsonb_build_object('orders', count(*), 'value_cents', coalesce(sum(total_cents), 0))
      from period where status in ('cancelled', 'rejected')
    ),
    'by_day', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'orders', coalesce(x.n, 0), 'revenue_cents', coalesce(x.rev, 0)) order by d.day)
      from (select generate_series(p_from, p_to, interval '1 day')::date as day) d
      left join (
        select (created_at at time zone v_tz)::date as day, count(*) as n, sum(total_cents) as rev from sales group by 1
      ) x on x.day = d.day
    ),
    'by_hour', (
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', coalesce(x.n, 0), 'revenue_cents', coalesce(x.rev, 0)) order by h.hour)
      from (select generate_series(0, 23) as hour) h
      left join (
        select extract(hour from created_at at time zone v_tz)::int as hour, count(*) as n, sum(total_cents) as rev
        from sales group by 1
      ) x on x.hour = h.hour
    ),
    'top_products', (
      select coalesce(jsonb_agg(t order by t.quantity desc, t.revenue_cents desc), '[]'::jsonb)
      from (
        select i.product_name_snapshot as name, sum(i.quantity) as quantity, sum(i.line_total_cents) as revenue_cents
        from public.order_items i
        where i.order_id in (select id from sales)
        group by 1
        order by 2 desc, 3 desc
        limit 20
      ) t
    ),
    'by_table', (
      select coalesce(jsonb_agg(t order by t.revenue_cents desc), '[]'::jsonb)
      from (
        select coalesce(tb.name, 'Sem mesa') as name, count(*) as orders,
               sum(s.total_cents) as revenue_cents, round(avg(s.total_cents)) as avg_ticket_cents
        from sales s left join public.tables tb on tb.id = s.table_id
        group by 1
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_sales(uuid, date, date) from public, anon;
grant execute on function public.report_sales(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Cobrança do SaaS (somente Admin Geral)
--
-- Plano e valor mensal por estabelecimento + pagamentos recebidos por mês de referência.
-- A situação (em teste, em dia, em atraso, isento) é calculada a partir desses dados.
-- O pagamento em si é registrado manualmente (cobrança online fica para a etapa de pagamentos).
-- ---------------------------------------------------------------------
create table public.organization_billing (
  organization_id      uuid primary key references public.organizations (id) on delete cascade,
  plan                 text not null default 'trial' check (plan in ('trial', 'basico', 'profissional', 'isento')),
  monthly_price_cents  bigint not null default 0 check (monthly_price_cents between 0 and 100000000),
  due_day              integer not null default 10 check (due_day between 1 and 28),
  trial_ends_at        date,
  notes                text check (char_length(notes) <= 500),
  updated_at           timestamptz not null default now()
);

create table public.billing_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  reference_month  date not null check (extract(day from reference_month) = 1),
  amount_cents     bigint not null check (amount_cents between 1 and 100000000),
  paid_at          date not null default current_date,
  method           text not null check (method in ('pix', 'boleto', 'cartao', 'dinheiro', 'transferencia')),
  notes            text check (char_length(notes) <= 280),
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (organization_id, reference_month)
);
create index billing_payments_org_idx on public.billing_payments (organization_id, reference_month desc);

create trigger organization_billing_updated_at before update on public.organization_billing
  for each row execute function private.set_updated_at();

alter table public.organization_billing enable row level security;
alter table public.billing_payments enable row level security;
revoke all on public.organization_billing, public.billing_payments from anon, authenticated;
grant select on public.organization_billing, public.billing_payments to authenticated;
create policy organization_billing_select on public.organization_billing for select to authenticated
  using (private.is_platform_admin());
create policy billing_payments_select on public.billing_payments for select to authenticated
  using (private.is_platform_admin());

-- Todo estabelecimento nasce em teste por 30 dias.
create function private.create_billing_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_billing (organization_id, trial_ends_at)
  values (new.id, (new.created_at at time zone 'America/Bahia')::date + 30)
  on conflict do nothing;
  return new;
end;
$$;

create trigger organizations_billing after insert on public.organizations
  for each row execute function private.create_billing_row();

insert into public.organization_billing (organization_id, trial_ends_at)
select id, (created_at at time zone 'America/Bahia')::date + 30 from public.organizations
on conflict do nothing;

create function public.platform_set_billing(
  p_org_id uuid, p_plan text, p_monthly_price_cents bigint, p_due_day integer, p_trial_ends_at date, p_notes text
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

  insert into public.organization_billing (organization_id, plan, monthly_price_cents, due_day, trial_ends_at, notes)
  values (p_org_id, p_plan, p_monthly_price_cents, p_due_day, p_trial_ends_at, nullif(trim(p_notes), ''))
  on conflict (organization_id) do update
  set plan = excluded.plan, monthly_price_cents = excluded.monthly_price_cents, due_day = excluded.due_day,
      trial_ends_at = excluded.trial_ends_at, notes = excluded.notes;

  perform private.write_audit(p_org_id, 'billing.updated', 'organization', p_org_id::text,
    jsonb_build_object('plan', p_plan, 'monthly_price_cents', p_monthly_price_cents, 'due_day', p_due_day));
end;
$$;

create function public.platform_record_payment(
  p_org_id uuid, p_reference_month date, p_amount_cents bigint, p_paid_at date, p_method text, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.billing_payments (organization_id, reference_month, amount_cents, paid_at, method, notes)
  values (p_org_id, date_trunc('month', p_reference_month)::date, p_amount_cents, coalesce(p_paid_at, current_date),
          p_method, nullif(trim(p_notes), ''))
  returning id into v_id;

  perform private.write_audit(p_org_id, 'billing.payment_recorded', 'billing_payment', v_id::text,
    jsonb_build_object('reference_month', date_trunc('month', p_reference_month)::date, 'amount_cents', p_amount_cents, 'method', p_method));
  return v_id;
exception
  when unique_violation then
    raise exception 'payment_exists' using errcode = 'P0001';
end;
$$;

create function public.platform_delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_payments;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.billing_payments where id = p_payment_id returning * into v_row;
  if v_row.id is not null then
    perform private.write_audit(v_row.organization_id, 'billing.payment_deleted', 'billing_payment', v_row.id::text,
      jsonb_build_object('reference_month', v_row.reference_month, 'amount_cents', v_row.amount_cents));
  end if;
end;
$$;

-- Números de cada estabelecimento para a visão geral (últimos 30 dias).
create function public.platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'organization_id', o.id,
      'orders_30d', (
        select count(*) from public.orders x
        where x.organization_id = o.id and x.created_at >= now() - interval '30 days'
          and x.status in ('received', 'preparing', 'ready', 'delivered')
      ),
      'revenue_30d_cents', (
        select coalesce(sum(x.total_cents), 0) from public.orders x
        where x.organization_id = o.id and x.created_at >= now() - interval '30 days'
          and x.status in ('received', 'preparing', 'ready', 'delivered')
      ),
      'last_order_at', (select max(x.created_at) from public.orders x where x.organization_id = o.id),
      'products', (select count(*) from public.products p where p.organization_id = o.id),
      'members', (select count(*) from public.memberships m where m.organization_id = o.id and m.status = 'active')
    ))
    from public.organizations o
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.platform_set_billing(uuid, text, bigint, integer, date, text) from public, anon;
revoke all on function public.platform_record_payment(uuid, date, bigint, date, text, text) from public, anon;
revoke all on function public.platform_delete_payment(uuid) from public, anon;
revoke all on function public.platform_overview() from public, anon;
grant execute on function public.platform_set_billing(uuid, text, bigint, integer, date, text) to authenticated;
grant execute on function public.platform_record_payment(uuid, date, bigint, date, text, text) to authenticated;
grant execute on function public.platform_delete_payment(uuid) to authenticated;
grant execute on function public.platform_overview() to authenticated;
