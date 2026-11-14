-- =====================================================================
-- Papel de parede do cardápio público (laterais da tela no desktop).
-- O estabelecimento escolhe o estilo; a cor vem da identidade visual (DARK/RED/WHITE).
-- Fica em organization_settings.settings.wallpaper. Mesma permissão do tema.
-- =====================================================================

create function public.set_organization_wallpaper(p_org_id uuid, p_wallpaper text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can(p_org_id, 'manage_theme') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_wallpaper not in ('none', 'food', 'bar', 'pizzaria', 'restaurante') then
    raise exception 'invalid wallpaper' using errcode = '22023';
  end if;

  update public.organization_settings
  set settings = settings || jsonb_build_object('wallpaper', p_wallpaper)
  where organization_id = p_org_id;
end;
$$;

revoke all on function public.set_organization_wallpaper(uuid, text) from public, anon;
grant execute on function public.set_organization_wallpaper(uuid, text) to authenticated;
