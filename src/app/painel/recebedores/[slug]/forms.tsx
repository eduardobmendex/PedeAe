"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { createRecipient, linkRecipient, savePaymentSettings, syncRecipient, unlinkRecipient } from "../actions";

/** Consulta o Pagar.me ao abrir a tela; botões "Atualizar status" e "Desvincular". */
export function RecipientStatusActions({ slug }: { slug: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ error?: string; success?: string }>();
  const [pending, start] = useTransition();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    syncRecipient(slug)
      .then((r) => {
        if (!alive) return;
        setChecking(false);
        if (!r.ok) setMsg({ error: r.error });
        else if (r.changed) router.refresh();
      })
      .catch(() => alive && (setChecking(false), setMsg({ error: "Sem conexão com o servidor." })));
    return () => {
      alive = false;
    };
  }, [slug, router]);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={pending || checking}
        onClick={() =>
          start(async () => {
            const r = await syncRecipient(slug).catch(() => ({ ok: false, error: "Sem conexão com o servidor.", changed: false }));
            setMsg(r.ok ? { success: r.changed ? "Status atualizado." : "Sem mudanças no Pagar.me." } : { error: r.error });
            router.refresh();
          })
        }
      >
        {checking ? "Consultando o Pagar.me…" : pending ? "Consultando…" : "Atualizar status"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="text-danger"
        disabled={pending}
        onClick={() => {
          if (!confirm("Desvincular o recebedor deste estabelecimento? O pagamento online será desligado. Nada é apagado no Pagar.me.")) return;
          start(async () => {
            setMsg(await unlinkRecipient(slug));
            router.refresh();
          });
        }}
      >
        Desvincular recebedor
      </Button>
      <div className="max-w-56" aria-live="polite">
        <FormMessage state={msg} />
      </div>
    </div>
  );
}

export function LinkRecipientForm({ slug, disabled }: { slug: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(linkRecipient.bind(null, slug), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="ID do recebedor" htmlFor="link-recipient">
        <Input id="link-recipient" name="recipient_id" placeholder="re_..." autoComplete="off" required />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending || disabled}>
        {pending ? "Consultando…" : "Vincular recebedor"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function OnlineSettingsForm({ slug, enabled, feePercent, hasRecipient }: { slug: string; enabled: boolean; feePercent: number; hasRecipient: boolean }) {
  const [state, action, pending] = useActionState(savePaymentSettings.bind(null, slug), undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={enabled} disabled={!hasRecipient} />
        Aceitar pagamento online (Pix e cartão) no cardápio
      </label>
      {!hasRecipient && <p className="text-xs text-muted">Disponível depois de iniciar o KYC (cadastrar o recebedor).</p>}
      <Field label="Comissão da PedeAe (%)" htmlFor="pg-fee" hint="Parte de cada pagamento que vai para o recebedor da PedeAe (PAGARME_PLATFORM_RECIPIENT_ID). 0 = sem comissão.">
        <Input id="pg-fee" name="platform_fee_percent" type="number" min={0} max={20} step={1} defaultValue={feePercent} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

/** "Iniciar KYC": cadastro do recebedor (pessoa física ou jurídica) com conta bancária. */
export function StartKycForm({ slug, disabled }: { slug: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(createRecipient.bind(null, slug), undefined);
  const [, startSubmit] = useTransition();
  const [kind, setKind] = useState<"individual" | "corporation">("corporation");
  const [interval, setInterval_] = useState("Daily");
  const form = useRef<HTMLFormElement>(null);

  async function lookupCep(value: string) {
    const cep = value.replace(/\D/g, "");
    if (cep.length !== 8 || !form.current) return;
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      .then((x) => x.json())
      .catch(() => null);
    if (!r || r.erro) return;
    const set = (name: string, v?: string) => {
      const el = form.current?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el && v && !el.value) el.value = v;
    };
    set("street", r.logradouro);
    set("neighborhood", r.bairro);
    set("city", r.localidade);
    set("state", r.uf);
  }

  const pj = kind === "corporation";
  return (
    <form
      ref={form}
      // Sem `action={...}`: o React limparia o formulário inteiro a cada envio (e o erro do Pagar.me faria perder tudo).
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSubmit(() => action(data));
      }}
      className="flex flex-col gap-6"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Tipo de cadastro</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["corporation", "Pessoa jurídica (CNPJ)", "Empresa, inclusive MEI"],
              ["individual", "Pessoa física (CPF)", "Sem CNPJ"],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-sm ${kind === value ? "border-brand bg-surface-2" : "border-border"}`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
                {label}
              </span>
              <span className="pl-6 text-xs text-muted">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {pj ? (
        <Section title="Empresa">
          <F label="Razão social" name="company_name" wide />
          <F label="Nome fantasia" name="trading_name" />
          <F label="CNPJ" name="document" inputMode="numeric" placeholder="00.000.000/0000-00" />
          <F label="Faturamento anual (R$)" name="annual_revenue" inputMode="decimal" placeholder="120.000,00" />
          <Field label="Natureza" htmlFor="kyc-corporation_type">
            <Select id="kyc-corporation_type" name="corporation_type" defaultValue="LTDA">
              {["MEI", "EI", "EIRELI", "LTDA", "SLU", "SA", "SS", "OUTRO"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <F label="Data de abertura" name="founding_date" type="date" />
        </Section>
      ) : (
        <Section title="Responsável">
          <F label="Nome completo" name="name" wide />
          <F label="CPF" name="document" inputMode="numeric" placeholder="000.000.000-00" />
          <F label="Data de nascimento" name="birthdate" type="date" />
          <F label="Nome da mãe (opcional)" name="mother_name" required={false} />
          <F label="Renda mensal (R$)" name="monthly_income" inputMode="decimal" placeholder="5.000,00" />
          <F label="Profissão" name="professional_occupation" placeholder="Empresário(a)" />
        </Section>
      )}

      <Section title="Contato">
        <F label="E-mail" name="email" type="email" />
        <F label="Celular com DDD" name="phone" type="tel" inputMode="tel" placeholder="(71) 99999-9999" />
        <F label="Site ou Instagram (opcional)" name="site_url" type="url" placeholder="https://" required={false} wide />
      </Section>

      <Section title={pj ? "Endereço da empresa" : "Endereço"}>
        <F label="CEP" name="zip_code" inputMode="numeric" placeholder="00000-000" onBlur={(e) => lookupCep(e.currentTarget.value)} />
        <F label="Rua" name="street" wide />
        <F label="Número" name="street_number" />
        <F label="Complemento (opcional)" name="complementary" required={false} />
        <F label="Bairro" name="neighborhood" />
        <F label="Cidade" name="city" />
        <Field label="UF" htmlFor="kyc-state">
          <Select id="kyc-state" name="state" defaultValue="" required>
            <option value="" disabled>
              —
            </option>
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <F label="Ponto de referência (opcional)" name="reference_point" required={false} />
      </Section>

      {pj && (
        <Section title="Sócio administrador (representante legal)" note="Quem vai fazer a prova de vida pelo link de KYC.">
          <F label="Nome completo" name="partner_name" wide />
          <F label="CPF" name="partner_document" inputMode="numeric" placeholder="000.000.000-00" />
          <F label="E-mail" name="partner_email" type="email" />
          <F label="Celular com DDD" name="partner_phone" type="tel" inputMode="tel" placeholder="(71) 99999-9999" />
          <F label="Data de nascimento" name="partner_birthdate" type="date" />
          <F label="Renda mensal (R$)" name="partner_monthly_income" inputMode="decimal" placeholder="5.000,00" />
          <F label="Profissão" name="partner_occupation" placeholder="Empresário(a)" />
          <F label="Nome da mãe (opcional)" name="partner_mother_name" required={false} />
        </Section>
      )}

      <Section title="Conta bancária para os repasses" note={`A conta precisa estar no ${pj ? "CNPJ" : "CPF"} informado acima.`}>
        <F label="Nome do titular" name="holder_name" maxLength={30} wide />
        <F label="Banco (código)" name="bank" inputMode="numeric" placeholder="001, 260, 341…" maxLength={3} />
        <Field label="Tipo de conta" htmlFor="kyc-account_type">
          <Select id="kyc-account_type" name="account_type" defaultValue="checking">
            <option value="checking">Corrente</option>
            <option value="savings">Poupança</option>
          </Select>
        </Field>
        <F label="Agência (sem dígito)" name="branch_number" inputMode="numeric" maxLength={4} />
        <F label="Dígito da agência (se houver)" name="branch_check_digit" maxLength={1} required={false} />
        <F label="Conta (sem dígito)" name="account_number" inputMode="numeric" maxLength={13} />
        <F label="Dígito da conta" name="account_check_digit" maxLength={2} />
      </Section>

      <Section title="Repasses">
        <Field label="Frequência" htmlFor="kyc-transfer_interval">
          <Select id="kyc-transfer_interval" name="transfer_interval" value={interval} onChange={(e) => setInterval_(e.target.value)}>
            <option value="Daily">Diário</option>
            <option value="Weekly">Semanal</option>
            <option value="Monthly">Mensal</option>
          </Select>
        </Field>
        {interval === "Weekly" ? (
          <Field label="Dia da semana" htmlFor="kyc-transfer_day">
            <Select id="kyc-transfer_day" name="transfer_day" defaultValue="1">
              {["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        ) : interval === "Monthly" ? (
          <F label="Dia do mês" name="transfer_day" type="number" min={1} max={31} defaultValue="5" />
        ) : (
          <input type="hidden" name="transfer_day" value="0" />
        )}
      </Section>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted">
          Os dados vão direto para o Pagar.me, que faz a análise de crédito e de risco. A PedeAe guarda só o ID e o status do recebedor.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || disabled}>
            {pending ? "Enviando ao Pagar.me…" : "Iniciar KYC"}
          </Button>
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">{title}</legend>
      {note && <p className="-mt-1 text-xs text-muted">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function F({ label, name, wide, required = true, ...props }: { label: string; name: string; wide?: boolean } & React.ComponentProps<"input">) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <Field label={label} htmlFor={`kyc-${name}`}>
        <Input id={`kyc-${name}`} name={name} required={required} autoComplete="off" {...props} />
      </Field>
    </div>
  );
}
