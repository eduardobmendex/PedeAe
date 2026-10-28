-- =====================================================================
-- Etapa 1 — Fundação multi-tenant
-- organizations, settings, profiles, memberships, convites, auditoria,
-- funções de autorização e políticas RLS.
-- =====================================================================

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.organization_status as enum ('active', 'suspended', 'cancelled');
create type public.member_role as enum ('admin', 'supervisor', 'staff');
create type public.member_status as enum ('active', 'disabled');

-- ---------------------------------------------------------------------
-- Utilitário: updated_at
-- ---------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 120),
  email       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Equipe da plataforma SaaS. Não confundir com o admin de um restaurante.
create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  status      public.organization_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.organization_settings (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  theme            text not null default 'light' check (theme in ('light', 'dark')),
  brand_color      text not null default '#E11D48' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color     text not null default '#F59E0B' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path        text,
  cover_path       text,
  settings         jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.member_role not null default 'staff',
  status           public.member_status not null default 'active',
  -- Ajustes finos das permissões "configuráveis" da matriz (ex.: {"manage_products": true}).
  permissions      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_org_idx on public.memberships (user_id, organization_id, status);

create table public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role             public.member_role not null default 'staff',
  token_hash       text not null unique,
  invited_by       uuid references auth.users (id) on delete set null,
  expires_at       timestamptz not null default now() + interval '7 days',
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users (id) on delete set null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (organization_id);

-- Registros de auditoria nunca são apagados: organizações com histórico não podem ser excluídas.
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete restrict,
  actor_user_id    uuid references auth.users (id) on delete set null,
  action           text not null,
  entity_type      text not null,
  entity_id        text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger organization_settings_updated_at before update on public.organization_settings
  for each row execute function private.set_updated_at();
create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Perfil criado automaticamente no cadastro
-- ---------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'name', ''), 120)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Funções de autorização (usadas pelas políticas RLS e pelas RPCs)
-- ---------------------------------------------------------------------
create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

-- Membro ativo da organização; se p_roles for informado, exige um dos papéis.
create function private.has_org_role(p_org_id uuid, p_roles public.member_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

-- O usuário atual compartilha alguma organização (como membro ativo) com p_user_id.
create function private.shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user_id
  );
$$;

create function private.write_audit(
  p_org_id uuid, p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_org_id, (select auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on function private.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function private.shares_org_with(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Privilégios de tabela (defesa em profundidade, além do RLS)
-- Escritas sensíveis só acontecem pelas RPCs abaixo.
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.platform_admins, public.organizations,
  public.organization_settings, public.memberships, public.invitations, public.audit_logs
  from anon, authenticated;

grant select on public.profiles, public.organizations, public.organization_settings,
  public.memberships, public.invitations, public.audit_logs to authenticated;
grant update (name) on public.profiles to authenticated;
grant update (name) on public.organizations to authenticated;
grant update (theme, brand_color, accent_color, logo_path, cover_path, settings)
  on public.organization_settings to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_logs enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id) or private.is_platform_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- platform_admins: sem políticas => inacessível pela API (gerenciado direto no banco).

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (private.has_org_role(id) or private.is_platform_admin());
create policy organizations_update_admin on public.organizations for update to authenticated
  using (private.has_org_role(id, array['admin']::public.member_role[]))
  with check (private.has_org_role(id, array['admin']::public.member_role[]));

-- organization_settings
create policy org_settings_select on public.organization_settings for select to authenticated
  using (private.has_org_role(organization_id) or private.is_platform_admin());
create policy org_settings_update_admin on public.organization_settings for update to authenticated
  using (private.has_org_role(organization_id, array['admin']::public.member_role[]))
  with check (private.has_org_role(organization_id, array['admin']::public.member_role[]));

-- memberships: cada um vê o próprio vínculo; admin/supervisor veem a equipe.
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_org_role(organization_id, array['admin', 'supervisor']::public.member_role[])
    or private.is_platform_admin()
  );

-- invitations: somente admins da organização.
create policy invitations_select_admin on public.invitations for select to authenticated
  using (private.has_org_role(organization_id, array['admin']::public.member_role[]));

-- audit_logs: admins da organização e equipe da plataforma.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (
    private.has_org_role(organization_id, array['admin']::public.member_role[])
    or private.is_platform_admin()
  );

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------

-- Cria um estabelecimento; quem cria vira admin.
create function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug)
  values (trim(p_name), lower(trim(p_slug)))
  returning id into v_org_id;

  insert into public.organization_settings (organization_id) values (v_org_id);

  insert into public.memberships (organization_id, user_id, role, status)
  values (v_org_id, v_uid, 'admin', 'active');

  perform private.write_audit(v_org_id, 'organization.created', 'organization', v_org_id::text,
    jsonb_build_object('name', trim(p_name), 'slug', lower(trim(p_slug))));

  return v_org_id;
end;
$$;

-- Cria um convite e devolve o token em texto puro (apenas nesta chamada).
create function public.create_invitation(p_org_id uuid, p_email text, p_role public.member_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  if not private.has_org_role(p_org_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.invitations (organization_id, email, role, token_hash, invited_by)
  values (p_org_id, lower(trim(p_email)), p_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()))
  returning id into v_id;

  perform private.write_audit(p_org_id, 'invitation.created', 'invitation', v_id::text,
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));

  return v_token;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id
  from public.invitations
  where id = p_invitation_id and accepted_at is null and revoked_at is null;

  if v_org_id is null or not private.has_org_role(v_org_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.invitations set revoked_at = now() where id = p_invitation_id;
  perform private.write_audit(v_org_id, 'invitation.revoked', 'invitation', p_invitation_id::text);
end;
$$;

-- Aceita um convite. O e-mail do usuário logado precisa ser o mesmo do convite.
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_inv public.invitations;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_inv
  from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null
     or v_inv.expires_at < now() then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  if v_inv.email <> v_email then
    raise exception 'invitation_email_mismatch' using errcode = 'P0001';
  end if;

  insert into public.memberships (organization_id, user_id, role, status)
  values (v_inv.organization_id, v_uid, v_inv.role, 'active')
  on conflict (organization_id, user_id)
  do update set role = excluded.role, status = 'active';

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  perform private.write_audit(v_inv.organization_id, 'invitation.accepted', 'invitation', v_inv.id::text,
    jsonb_build_object('role', v_inv.role));

  return v_inv.organization_id;
end;
$$;

-- Altera papel/status de um membro. Admin não altera o próprio vínculo
-- (evita a organização ficar sem administrador por engano).
create function public.update_membership(
  p_membership_id uuid, p_role public.member_role, p_status public.member_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership_id for update;

  if v_m.id is null or not private.has_org_role(v_m.organization_id, array['admin']::public.member_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_m.user_id = (select auth.uid()) then
    raise exception 'cannot_change_own_membership' using errcode = 'P0001';
  end if;

  update public.memberships set role = p_role, status = p_status where id = p_membership_id;

  perform private.write_audit(v_m.organization_id, 'membership.updated', 'membership', v_m.id::text,
    jsonb_build_object('from', jsonb_build_object('role', v_m.role, 'status', v_m.status),
                       'to', jsonb_build_object('role', p_role, 'status', p_status)));
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
revoke all on function public.create_invitation(uuid, text, public.member_role) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.update_membership(uuid, public.member_role, public.member_status) from public, anon;

grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.create_invitation(uuid, text, public.member_role) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.update_membership(uuid, public.member_role, public.member_status) to authenticated;
