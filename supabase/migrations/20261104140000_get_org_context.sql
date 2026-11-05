-- =====================================================================
-- Contexto de autorização de uma página do painel em UMA chamada só
-- (antes eram três idas ao banco em sequência a cada navegação).
-- Devolve null se o usuário não for membro ativo nem admin da plataforma.
-- =====================================================================
create function public.get_org_context(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status),
    'membership', case when m.id is null then null
      else jsonb_build_object('id', m.id, 'role', m.role, 'permissions', m.permissions) end,
    'is_platform_admin', private.is_platform_admin()
  )
  from public.organizations o
  left join public.memberships m
    on m.organization_id = o.id and m.user_id = (select auth.uid()) and m.status = 'active'
  where o.slug = p_slug
    and (m.id is not null or private.is_platform_admin());
$$;

revoke all on function public.get_org_context(text) from public, anon;
grant execute on function public.get_org_context(text) to authenticated;
