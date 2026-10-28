-- =====================================================================
-- Etapa 2 — Matriz de permissões (RBAC com ajustes por membro)
-- e auditoria automática de configurações do estabelecimento.
-- =====================================================================

-- Regra de cada papel para cada permissão:
--   yes = sempre permitido | no = nunca
--   on  = configurável, padrão permitido | off = configurável, padrão negado
-- Admin do restaurante sempre pode tudo. Espelhado em src/lib/permissions.ts.
create function private.permission_rule(p_role public.member_role, p_permission text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role = 'admin' then 'yes' else coalesce((
    select t.rule
    from (values
      ('supervisor', 'manage_brand',        'no'),
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

-- O usuário atual (membro ativo) tem a permissão no estabelecimento?
create function private.can(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case private.permission_rule(m.role, p_permission)
      when 'yes' then true
      when 'on'  then coalesce((m.permissions ->> p_permission)::boolean, true)
      when 'off' then coalesce((m.permissions ->> p_permission)::boolean, false)
      else false
    end
    from public.memberships m
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  ), false);
$$;

grant execute on function private.permission_rule(public.member_role, text) to authenticated;
grant execute on function private.can(uuid, text) to authenticated;

-- Ajusta as permissões configuráveis de um membro. Chaves não configuráveis
-- para o papel do membro são descartadas.
create function public.set_membership_permissions(p_membership_id uuid, p_permissions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.memberships;
  v_clean jsonb;
begin
  select * into v_m from public.memberships where id = p_membership_id for update;

  if v_m.id is null or not private.has_org_role(v_m.organization_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_m.user_id = (select auth.uid()) then
    raise exception 'cannot_change_own_membership' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_clean
  from jsonb_each(coalesce(p_permissions, '{}'::jsonb))
  where jsonb_typeof(value) = 'boolean'
    and private.permission_rule(v_m.role, key) in ('on', 'off');

  update public.memberships set permissions = v_clean where id = p_membership_id;

  perform private.write_audit(v_m.organization_id, 'membership.permissions_updated', 'membership', v_m.id::text,
    jsonb_build_object('from', v_m.permissions, 'to', v_clean));
end;
$$;

revoke all on function public.set_membership_permissions(uuid, jsonb) from public, anon;
grant execute on function public.set_membership_permissions(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria automática de alterações de marca/configurações e do nome
-- ---------------------------------------------------------------------
create function private.audit_row_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old) - 'updated_at';
  v_new jsonb := to_jsonb(new) - 'updated_at';
  v_changes jsonb;
begin
  select jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value)) into v_changes
  from jsonb_each(v_new)
  where v_old -> key is distinct from value;

  if v_changes is not null then
    perform private.write_audit(
      coalesce(v_new ->> 'organization_id', v_new ->> 'id')::uuid,
      tg_argv[0], tg_table_name, coalesce(v_new ->> 'organization_id', v_new ->> 'id'), v_changes);
  end if;
  return new;
end;
$$;

create trigger organization_settings_audit after update on public.organization_settings
  for each row execute function private.audit_row_update('settings.updated');
create trigger organizations_audit after update on public.organizations
  for each row execute function private.audit_row_update('organization.updated');
