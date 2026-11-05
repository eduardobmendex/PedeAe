-- =====================================================================
-- Identidades visuais: dark (Black & Gold), red (Red Passion), white (Clean & Fresh).
-- A identidade passa a valer para todo o estabelecimento: cardápio e painel.
-- Lista de ids espelhada em src/lib/themes.ts.
-- =====================================================================

alter table public.organization_settings drop constraint organization_settings_theme_check;

-- Quem já personalizou as cores mantém: as cores próprias continuam ligadas.
update public.organization_settings
set settings = settings || '{"custom_colors": true}'::jsonb
where upper(brand_color) <> '#E11D48' or upper(accent_color) <> '#F59E0B';

update public.organization_settings set theme = 'white' where theme = 'light';

alter table public.organization_settings
  alter column theme set default 'white',
  add constraint organization_settings_theme_check check (theme in ('dark', 'red', 'white'));

-- O contexto da página já traz a identidade, sem outra ida ao banco.
create or replace function public.get_org_context(p_slug text)
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
    'is_platform_admin', private.is_platform_admin(),
    'branding', jsonb_build_object('theme', s.theme, 'brand_color', s.brand_color,
      'accent_color', s.accent_color, 'settings', s.settings)
  )
  from public.organizations o
  join public.organization_settings s on s.organization_id = o.id
  left join public.memberships m
    on m.organization_id = o.id and m.user_id = (select auth.uid()) and m.status = 'active'
  where o.slug = p_slug
    and (m.id is not null or private.is_platform_admin());
$$;
