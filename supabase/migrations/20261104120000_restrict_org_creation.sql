-- =====================================================================
-- Somente o administrador da plataforma cria estabelecimentos.
-- Remove a função que permitia a qualquer usuário logado criar o seu
-- (e virar admin dele). Resta public.platform_create_organization.
-- =====================================================================
drop function public.create_organization(text, text);
