-- =====================================================================
-- A identidade visual é escolhida dentro do estabelecimento, por supervisor
-- ou acima (e pelo admin da plataforma). O restante da marca continua só do admin.
-- =====================================================================

create or replace function private.permission_rule(p_role public.member_role, p_permission text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role = 'admin' then 'yes' else coalesce((
    select t.rule
    from (values
      ('supervisor', 'manage_brand',        'no'),
      ('supervisor', 'manage_theme',        'yes'),
      ('supervisor', 'manage_menu',         'on'),
      ('supervisor', 'manage_tables',       'on'),
      ('supervisor', 'view_orders',         'yes'),
      ('supervisor', 'create_manual_order', 'yes'),
      ('supervisor', 'apply_coupons',       'yes'),
      ('supervisor', 'manage_coupons',      'on'),
      ('supervisor', 'cancel_orders',       'on'),
      ('supervisor', 'receive_payments',    'on'),
      ('supervisor', 'close_tabs',          'yes'),
      ('supervisor', 'view_reports',        'on'),
      ('supervisor', 'manage_team',         'no'),
      ('staff',      'manage_brand',        'no'),
      ('staff',      'manage_theme',        'no'),
      ('staff',      'manage_menu',         'no'),
      ('staff',      'manage_tables',       'no'),
      ('staff',      'view_orders',         'yes'),
      ('staff',      'create_manual_order', 'yes'),
      ('staff',      'apply_coupons',       'off'),
      ('staff',      'manage_coupons',      'no'),
      ('staff',      'cancel_orders',       'off'),
      ('staff',      'receive_payments',    'off'),
      ('staff',      'close_tabs',          'off'),
      ('staff',      'view_reports',        'no'),
      ('staff',      'manage_team',         'no')
    ) as t (role, permission, rule)
    where t.role = p_role::text and t.permission = p_permission
  ), 'no') end;
$$;

-- Supervisor não tem update direto em organization_settings: a troca passa por aqui.
create function public.set_organization_theme(p_org_id uuid, p_theme text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can(p_org_id, 'manage_theme') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Escolher uma identidade desliga as cores próprias. A auditoria vem do trigger da tabela.
  update public.organization_settings
  set theme = p_theme, settings = settings || '{"custom_colors": false}'::jsonb
  where organization_id = p_org_id;
end;
$$;

revoke all on function public.set_organization_theme(uuid, text) from public, anon;
grant execute on function public.set_organization_theme(uuid, text) to authenticated;
