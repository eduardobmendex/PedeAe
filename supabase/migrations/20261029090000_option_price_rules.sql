-- =====================================================================
-- Regra de preço por grupo de adicionais:
--   sum = soma dos itens escolhidos (padrão; extras, bordas)
--   max = cobra o item mais caro (pizza meio a meio pelo sabor mais caro)
--   avg = média dos itens escolhidos (arredondada ao centavo)
-- =====================================================================

alter table public.product_options
  add column price_rule text not null default 'sum' check (price_rule in ('sum', 'max', 'avg'));

create or replace function private.place_order(
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
  v_group_sum bigint;
  v_group_max bigint;
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
      v_group_sum := 0;
      v_group_max := 0;
      for v_opt_item in
        select i.id, i.name, i.price_delta_cents
        from public.product_option_items i
        where i.option_id = v_option.id and i.id = any (v_selected) and i.available
        order by i.sort_order
      loop
        v_matched := v_matched + 1;
        v_group_sum := v_group_sum + v_opt_item.price_delta_cents;
        v_group_max := greatest(v_group_max, v_opt_item.price_delta_cents);
        v_line_options := v_line_options || jsonb_build_object(
          'option', v_option.name, 'item', v_opt_item.name, 'price', v_opt_item.price_delta_cents);
      end loop;

      -- Item indisponível ou de outro grupo => contagem não bate.
      if v_matched <> v_count then
        raise exception 'option_unavailable' using errcode = 'P0001', detail = v_product.name;
      end if;

      -- Regra de preço do grupo: soma (padrão), maior valor (pizza meio a meio) ou média.
      v_unit := v_unit + case v_option.price_rule
        when 'max' then v_group_max
        when 'avg' then case when v_count > 0 then round(v_group_sum::numeric / v_count)::bigint else 0 end
        else v_group_sum
      end;
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
            'image_path', p.image_path, 'featured', p.featured,
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

create or replace function public.save_product_options(p_product_id uuid, p_groups jsonb)
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
    insert into public.product_options (organization_id, product_id, name, min_select, max_select, price_rule, sort_order)
    values (v_org, p_product_id, trim(v_group ->> 'name'),
            coalesce((v_group ->> 'min_select')::int, 0), coalesce((v_group ->> 'max_select')::int, 1),
            coalesce(v_group ->> 'price_rule', 'sum'), v_g)
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
