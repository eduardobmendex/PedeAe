-- =====================================================================
-- Pedidos em tempo real no painel e na cozinha (Supabase Realtime).
-- O Realtime aplica o RLS de orders (orders_select → view_orders) a cada evento:
-- cada membro só recebe pedidos do próprio estabelecimento.
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
