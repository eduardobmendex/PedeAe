-- =====================================================================
-- Troca do tipo do cardápio (ex.: pizzaria → bar) com os produtos padrão do tipo alvo.
--
-- Nada é apagado:
--   • produtos vindos do catálogo base ficam disponíveis só se pertencem ao tipo alvo
--     (voltar ao tipo anterior traz os produtos de volta, com os preços já editados);
--   • produtos do catálogo do tipo alvo que ainda não existem são importados;
--   • ficam publicadas só as categorias com produtos do tipo alvo; as outras ficam ocultas
--     (produtos criados à mão continuam onde estão);
--   • o papel de parede passa a ser o do tipo e o tipo fica salvo em settings.
-- =====================================================================

create function private.wallpaper_for_type(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'pizzaria' then 'pizzaria'
    when 'bar' then 'bar'
    when 'regional' then 'restaurante'
    else 'food'
  end;
$$;

create function public.switch_menu_type(p_org_id uuid, p_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_import jsonb;
  v_published int;
begin
  if not (private.can(p_org_id, 'manage_menu') and private.can(p_org_id, 'manage_theme')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.establishment_types where id = p_type) then
    raise exception 'invalid_type' using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object('key', ci.key) order by ci.category_sort, ci.sort_order)
  into v_items
  from public.catalog_items ci
  where ci.active and p_type = any (ci.types);
  if v_items is null then
    raise exception 'empty_type' using errcode = 'P0001';
  end if;

  -- 1. Tudo oculto; o que é do tipo alvo volta a seguir.
  update public.categories set active = false where organization_id = p_org_id;

  -- 2. Itens do catálogo do tipo alvo que ainda faltam (entram disponíveis, pois as categorias estão ocultas).
  v_import := public.import_catalog_items(p_org_id, v_items);

  -- 3. Produtos do catálogo: disponíveis só os do tipo alvo.
  update public.products p
  set available = exists (
    select 1 from public.catalog_items ci
    where ci.key = p.source_catalog_key and ci.active and p_type = any (ci.types)
  )
  where p.organization_id = p_org_id and p.source_catalog_key is not null;

  -- 4. Publica as categorias que têm produtos do tipo alvo, na ordem do catálogo.
  update public.categories c
  set active = true,
      sort_order = coalesce((
        select min(ci.category_sort) from public.catalog_items ci where lower(ci.category) = lower(c.name)
      ), c.sort_order)
  where c.organization_id = p_org_id
    and exists (
      select 1 from public.products p
      join public.catalog_items ci on ci.key = p.source_catalog_key
      where p.category_id = c.id and p.available and p_type = any (ci.types)
    );
  get diagnostics v_published = row_count;

  -- 5. Papel de parede e tipo do estabelecimento.
  update public.organization_settings
  set settings = settings || jsonb_build_object('establishment_type', p_type, 'wallpaper', private.wallpaper_for_type(p_type))
  where organization_id = p_org_id;

  perform private.write_audit(p_org_id, 'menu.type_switched', 'organization', p_org_id::text,
    jsonb_build_object('type', p_type, 'imported', v_import -> 'imported', 'categories_published', v_published));

  return jsonb_build_object(
    'imported', v_import -> 'imported',
    'categories_published', v_published,
    'wallpaper', private.wallpaper_for_type(p_type)
  );
end;
$$;

revoke all on function public.switch_menu_type(uuid, text) from public, anon;
grant execute on function public.switch_menu_type(uuid, text) to authenticated;
