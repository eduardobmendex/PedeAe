-- Recebedores do Pagar.me e KYC (credenciamento) de cada estabelecimento.
-- O status vem sempre do Pagar.me (consulta na tela do Admin Geral e webhook recipient.updated).
-- Pagamento online só funciona com o recebedor aprovado (status "active").

alter table public.organization_payment_settings
  add column recipient_status text
    check (recipient_status in ('registration', 'affiliation', 'active', 'refused', 'suspended', 'blocked', 'inactive')),
  add column kyc_status text,
  add column kyc_status_reason text,
  add column recipient_type text check (recipient_type in ('individual', 'corporation')),
  add column recipient_name text,
  add column recipient_synced_at timestamptz,
  add column kyc_link_sent_at timestamptz;

-- "recebedores" é uma rota do painel (/painel/recebedores): não pode ser slug de estabelecimento.
alter table public.organizations add constraint organizations_slug_not_reserved check (slug not in ('recebedores'));

create or replace function private.online_payments_enabled(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled and pagarme_recipient_id is not null and recipient_status = 'active'
                   from public.organization_payment_settings where organization_id = p_org_id), false);
$$;

-- Liga/desliga e comissão. Trocar (ou remover) o recebedor zera o status conhecido.
create or replace function public.platform_set_payment_settings(
  p_org_id uuid, p_enabled boolean, p_recipient_id text, p_platform_fee_percent integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := nullif(trim(p_recipient_id), '');
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.organization_payment_settings (organization_id, enabled, pagarme_recipient_id, platform_fee_percent)
  values (p_org_id, p_enabled, v_recipient, p_platform_fee_percent)
  on conflict (organization_id) do update
  set enabled = excluded.enabled,
      pagarme_recipient_id = excluded.pagarme_recipient_id,
      platform_fee_percent = excluded.platform_fee_percent,
      recipient_status = case when organization_payment_settings.pagarme_recipient_id is distinct from excluded.pagarme_recipient_id
                              then null else organization_payment_settings.recipient_status end,
      kyc_status = case when organization_payment_settings.pagarme_recipient_id is distinct from excluded.pagarme_recipient_id
                        then null else organization_payment_settings.kyc_status end,
      kyc_status_reason = case when organization_payment_settings.pagarme_recipient_id is distinct from excluded.pagarme_recipient_id
                               then null else organization_payment_settings.kyc_status_reason end,
      recipient_type = case when organization_payment_settings.pagarme_recipient_id is distinct from excluded.pagarme_recipient_id
                            then null else organization_payment_settings.recipient_type end,
      recipient_name = case when organization_payment_settings.pagarme_recipient_id is distinct from excluded.pagarme_recipient_id
                            then null else organization_payment_settings.recipient_name end,
      kyc_link_sent_at = case when organization_payment_settings.pagarme_recipient_id is distinct from excluded.pagarme_recipient_id
                              then null else organization_payment_settings.kyc_link_sent_at end;
  perform private.write_audit(p_org_id, 'payments.settings_updated', 'organization', p_org_id::text,
    jsonb_build_object('enabled', p_enabled, 'platform_fee_percent', p_platform_fee_percent, 'recipient_id', v_recipient));
end;
$$;

-- Grava o que o Pagar.me respondeu. Registra na auditoria quando o status muda.
create function private.apply_recipient_status(
  p_org_id uuid, p_recipient_id text, p_status text, p_kyc_status text, p_kyc_reason text, p_type text, p_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
begin
  if p_recipient_id !~ '^(re|rp)_[A-Za-z0-9]+$' then
    raise exception 'invalid_recipient' using errcode = 'P0001';
  end if;
  select recipient_status, kyc_status, pagarme_recipient_id into v_old
  from public.organization_payment_settings where organization_id = p_org_id;

  insert into public.organization_payment_settings
    (organization_id, pagarme_recipient_id, recipient_status, kyc_status, kyc_status_reason, recipient_type, recipient_name, recipient_synced_at)
  values (p_org_id, p_recipient_id, p_status, p_kyc_status, p_kyc_reason, p_type, p_name, now())
  on conflict (organization_id) do update
  set pagarme_recipient_id = excluded.pagarme_recipient_id,
      recipient_status = excluded.recipient_status,
      kyc_status = excluded.kyc_status,
      kyc_status_reason = excluded.kyc_status_reason,
      recipient_type = coalesce(excluded.recipient_type, organization_payment_settings.recipient_type),
      recipient_name = coalesce(excluded.recipient_name, organization_payment_settings.recipient_name),
      recipient_synced_at = now();

  if v_old.pagarme_recipient_id is distinct from p_recipient_id
     or v_old.recipient_status is distinct from p_status
     or v_old.kyc_status is distinct from p_kyc_status then
    perform private.write_audit(p_org_id, 'payments.recipient_status', 'organization', p_org_id::text,
      jsonb_build_object('recipient_id', p_recipient_id, 'status', p_status, 'previous_status', v_old.recipient_status,
                         'kyc_status', p_kyc_status, 'kyc_status_reason', p_kyc_reason));
    return true;
  end if;
  return false;
end;
$$;
revoke all on function private.apply_recipient_status(uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- Admin Geral: vincula/atualiza o recebedor com os dados lidos do Pagar.me. Devolve true se algo mudou.
create function public.platform_sync_recipient(
  p_org_id uuid, p_recipient_id text, p_status text, p_kyc_status text, p_kyc_reason text, p_type text, p_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.apply_recipient_status(p_org_id, p_recipient_id, p_status, p_kyc_status, p_kyc_reason, p_type, p_name);
end;
$$;
revoke all on function public.platform_sync_recipient(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.platform_sync_recipient(uuid, text, text, text, text, text, text) to authenticated;

-- Webhook (chave secreta do servidor): atualiza pelo ID do recebedor. Devolve o slug se algo mudou.
create function public.service_sync_recipient(
  p_recipient_id text, p_status text, p_kyc_status text, p_kyc_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_slug text;
begin
  select s.organization_id, o.slug into v_org, v_slug
  from public.organization_payment_settings s join public.organizations o on o.id = s.organization_id
  where s.pagarme_recipient_id = p_recipient_id;
  if v_org is null then
    return null;
  end if;
  if private.apply_recipient_status(v_org, p_recipient_id, p_status, p_kyc_status, p_kyc_reason, null, null) then
    return v_slug;
  end if;
  return null;
end;
$$;
revoke all on function public.service_sync_recipient(text, text, text, text) from public, anon, authenticated;
grant execute on function public.service_sync_recipient(text, text, text, text) to service_role;

-- Marca quando o link de KYC foi gerado (para a tela mostrar "link enviado").
create function public.platform_mark_kyc_link(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.organization_payment_settings set kyc_link_sent_at = now() where organization_id = p_org_id;
  perform private.write_audit(p_org_id, 'payments.kyc_link_created', 'organization', p_org_id::text, '{}'::jsonb);
end;
$$;
revoke all on function public.platform_mark_kyc_link(uuid) from public, anon;
grant execute on function public.platform_mark_kyc_link(uuid) to authenticated;
