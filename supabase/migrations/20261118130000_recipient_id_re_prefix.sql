-- Contas atuais do Pagar.me identificam recebedores como "re_..."; contas antigas, "rp_...". Aceita os dois.
alter table public.organization_payment_settings
  drop constraint organization_payment_settings_pagarme_recipient_id_check;

alter table public.organization_payment_settings
  add constraint organization_payment_settings_pagarme_recipient_id_check
  check (pagarme_recipient_id ~ '^(re|rp)_[A-Za-z0-9]+$');
