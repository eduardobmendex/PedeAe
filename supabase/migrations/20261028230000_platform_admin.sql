-- =====================================================================
-- Administrador da plataforma (dono do SaaS): poderes de admin em TODOS
-- os estabelecimentos, criação/suspensão de estabelecimentos e cadastro
-- direto de usuários com senha. Usuários comuns continuam restritos ao
-- próprio estabelecimento.
-- =====================================================================

-- As duas funções-base de autorização passam a reconhecer o admin da plataforma.
-- Todas as políticas RLS e RPCs que dependem delas herdam o comportamento.
create or replace function private.has_org_role(p_org_id uuid, p_roles public.member_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or exists (
    select 1
    from public.memberships m
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function private.can(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or coalesce((
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

-- O app precisa saber se o usuário atual é admin da plataforma.
create function public.am_i_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin();
$$;

-- ---------------------------------------------------------------------
-- Estabelecimentos
-- ---------------------------------------------------------------------

-- Cria um estabelecimento para um cliente (sem tornar o admin da plataforma membro).
create function public.platform_create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug) values (trim(p_name), lower(trim(p_slug)))
  returning id into v_org_id;
  insert into public.organization_settings (organization_id) values (v_org_id);

  perform private.write_audit(v_org_id, 'organization.created', 'organization', v_org_id::text,
    jsonb_build_object('name', trim(p_name), 'slug', lower(trim(p_slug)), 'by', 'platform'));
  return v_org_id;
end;
$$;

-- Suspende/reativa/cancela. Estabelecimento não ativo some do cardápio público
-- e deixa de receber pedidos (regras já existentes em get_public_menu e create_customer_order).
create function public.platform_set_organization_status(p_org_id uuid, p_status public.organization_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.organizations set status = p_status where id = p_org_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Cadastro direto de usuário com senha e vínculo ao estabelecimento.
-- Se o e-mail já tiver conta, apenas cria/atualiza o vínculo (a senha
-- existente NÃO é alterada).
-- ---------------------------------------------------------------------
create function public.platform_create_member(
  p_org_id uuid, p_email text, p_name text, p_password text, p_role public.member_role
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_user_id uuid;
  v_created boolean := false;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email;

  if v_user_id is null then
    if char_length(coalesce(p_password, '')) < 8 then
      raise exception 'weak_password' using errcode = 'P0001';
    end if;

    v_user_id := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token)
    values (v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', left(trim(coalesce(p_name, '')), 120)), now(), now(),
      '', '', '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
    values (gen_random_uuid(), v_user_id, v_user_id::text, 'email',
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true), now(), now());
    v_created := true;
  end if;

  insert into public.memberships (organization_id, user_id, role, status)
  values (p_org_id, v_user_id, p_role, 'active')
  on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active';

  perform private.write_audit(p_org_id, 'membership.created_by_platform', 'membership', v_user_id::text,
    jsonb_build_object('email', v_email, 'role', p_role, 'new_account', v_created));

  return jsonb_build_object('user_id', v_user_id, 'created', v_created);
end;
$$;

revoke all on function public.am_i_platform_admin() from public, anon;
revoke all on function public.platform_create_organization(text, text) from public, anon;
revoke all on function public.platform_set_organization_status(uuid, public.organization_status) from public, anon;
revoke all on function public.platform_create_member(uuid, text, text, text, public.member_role) from public, anon;

grant execute on function public.am_i_platform_admin() to authenticated;
grant execute on function public.platform_create_organization(text, text) to authenticated;
grant execute on function public.platform_set_organization_status(uuid, public.organization_status) to authenticated;
grant execute on function public.platform_create_member(uuid, text, text, text, public.member_role) to authenticated;
