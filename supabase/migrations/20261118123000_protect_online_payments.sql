-- Pagamento online confirmado é dinheiro que já entrou: não pode ser excluído pelo painel
-- (estorno é feito no Pagar.me). Pagamentos registrados à mão continuam excluíveis.
create or replace function public.delete_tab_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.tab_payments;
  v_status public.table_session_status;
begin
  select * into v_p from public.tab_payments where id = p_payment_id;
  if v_p.id is null or not private.can(v_p.organization_id, 'receive_payments') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_p.payment_intent_id is not null then
    raise exception 'online_payment' using errcode = 'P0001';
  end if;
  select status into v_status from public.table_sessions where id = v_p.table_session_id for update;
  if v_status <> 'open' then
    raise exception 'tab_closed' using errcode = 'P0001';
  end if;
  delete from public.tab_payments where id = p_payment_id;
  perform private.write_audit(v_p.organization_id, 'tab.payment_deleted', 'table_session', v_p.table_session_id::text,
    jsonb_build_object('amount_cents', v_p.amount_cents, 'method', v_p.method));
end;
$$;
