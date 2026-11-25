-- =====================================================================
-- Foto padrão do catálogo base definida pelo Admin Geral (tela /painel/catalogo).
--
-- catalog_items.image_path continua sendo a foto EFETIVA (lida pela importação e pelas telas).
--   * default_image_path: foto que vem do código (supabase/catalog/imagens.mjs, gerada nas migrations);
--   * custom_image_path:  foto enviada pelo Admin Geral, no bucket catalog-images.
--   image_path = coalesce(custom_image_path, default_image_path).
-- Novas versões do catálogo (scripts/build-catalog-migration.mjs) atualizam só a default e
-- respeitam a personalizada.
--
-- Formato da personalizada: "catalog-images/<chave do item>/<uuid>.<jpg|png|webp>"
-- (o app monta a URL pública do Storage; independe do domínio do projeto).
-- =====================================================================

alter table public.catalog_items
  add column default_image_path text,
  add column custom_image_path text
    check (custom_image_path ~ '^catalog-images/[a-z0-9-]+/[0-9a-f-]{36}\.(jpg|png|webp)$');

update public.catalog_items set default_image_path = image_path;

-- "catalogo" é uma rota do painel (/painel/catalogo): não pode ser slug de estabelecimento.
alter table public.organizations drop constraint organizations_slug_not_reserved;
alter table public.organizations add constraint organizations_slug_not_reserved
  check (slug not in ('recebedores', 'catalogo'));

-- ---------------------------------------------------------------------
-- Storage: leitura pública; só o Admin Geral envia ou apaga.
-- Caminho do objeto: <chave do item>/<uuid>.<ext>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-images', 'catalog-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy catalog_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog-images' and private.is_platform_admin());
create policy catalog_images_update on storage.objects for update to authenticated
  using (bucket_id = 'catalog-images' and private.is_platform_admin());
create policy catalog_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'catalog-images' and private.is_platform_admin());
create policy catalog_images_select_admin on storage.objects for select to authenticated
  using (bucket_id = 'catalog-images' and private.is_platform_admin());

-- ---------------------------------------------------------------------
-- Define (p_path) ou remove (null) a foto personalizada de um item.
-- p_propagate: atualiza também os produtos já importados que ainda usam foto do catálogo
-- (sem foto, arquivo do app, link externo ou foto personalizada). Foto enviada pelo
-- estabelecimento nunca é trocada.
-- Devolve a personalizada anterior (para o app apagar o arquivo) e os slugs afetados
-- (para invalidar o cardápio público em cache).
-- ---------------------------------------------------------------------
create function public.platform_set_catalog_image(p_key text, p_path text, p_propagate boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.catalog_items%rowtype;
  v_new text;
  v_slugs text[] := '{}';
  v_products int := 0;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_path is not null and not starts_with(p_path, 'catalog-images/' || p_key || '/') then
    raise exception 'invalid_image' using errcode = 'P0001';
  end if;

  select * into v_item from public.catalog_items where key = p_key for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  v_new := coalesce(p_path, v_item.default_image_path);
  update public.catalog_items set custom_image_path = p_path, image_path = v_new where key = p_key;

  if p_propagate then
    with changed as (
      update public.products p set image_path = v_new
      where p.source_catalog_key = p_key
        and p.image_path is distinct from v_new
        and (p.image_path is null or p.image_path like '/catalog/%' or p.image_path like 'https://%'
             or p.image_path like 'catalog-images/%')
      returning p.organization_id
    )
    select count(*)::int, coalesce(array_agg(distinct o.slug), '{}')
    into v_products, v_slugs
    from changed c join public.organizations o on o.id = c.organization_id;
  end if;

  return jsonb_build_object('previous', v_item.custom_image_path, 'products', v_products, 'slugs', to_jsonb(v_slugs));
end;
$$;

revoke all on function public.platform_set_catalog_image(text, text, boolean) from public, anon;
grant execute on function public.platform_set_catalog_image(text, text, boolean) to authenticated;

-- Quantos estabelecimentos importaram cada item (para a tela do Admin Geral).
create function public.platform_catalog_usage()
returns table (key text, organizations int, using_catalog_photo int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.source_catalog_key, count(distinct p.organization_id)::int,
      count(distinct p.organization_id) filter (
        where p.image_path is null or p.image_path like '/catalog/%' or p.image_path like 'https://%'
           or p.image_path like 'catalog-images/%')::int
    from public.products p
    where p.source_catalog_key is not null
    group by p.source_catalog_key;
end;
$$;

revoke all on function public.platform_catalog_usage() from public, anon;
grant execute on function public.platform_catalog_usage() to authenticated;
