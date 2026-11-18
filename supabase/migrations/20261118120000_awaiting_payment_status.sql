-- Pedido pago antecipadamente: criado como "aguardando pagamento" e só vai para a fila
-- (recebido / aguardando confirmação) quando o pagamento online é confirmado.
-- Em arquivo próprio: um valor novo de enum só pode ser usado depois de confirmado.
alter type public.order_status add value if not exists 'awaiting_payment' before 'pending_confirmation';
