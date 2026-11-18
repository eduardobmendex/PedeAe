"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage, Input, Select, Textarea } from "@/components/ui";
import { paymentMethods, planIds, plans, type Billing, type PlanId } from "@/lib/billing";
import { centsToInput } from "@/lib/money";
import { recordPayment, saveBilling, savePaymentSettings } from "./actions";

export function BillingForm({ slug, billing, notes }: { slug: string; billing: Billing; notes: string }) {
  const [state, action, pending] = useActionState(saveBilling.bind(null, slug), undefined);
  const [plan, setPlan] = useState<PlanId>(billing.plan);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Plano" htmlFor="b-plan">
        <Select id="b-plan" name="plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} className="w-full">
          {planIds.map((p) => (
            <option key={p} value={p}>
              {plans[p].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Mensalidade (R$)" htmlFor="b-price" hint={plans[plan].paid ? undefined : "Não é cobrada neste plano."}>
        <Input id="b-price" name="monthly_price" inputMode="decimal" defaultValue={centsToInput(billing.monthly_price_cents)} required />
      </Field>
      <Field label="Dia do vencimento" htmlFor="b-due" hint="Entre 1 e 28.">
        <Input id="b-due" name="due_day" type="number" min={1} max={28} defaultValue={billing.due_day} required />
      </Field>
      <Field label="Fim do teste" htmlFor="b-trial" hint={plan === "trial" ? "Obrigatório no teste grátis." : "Só vale para o teste grátis."}>
        <Input id="b-trial" name="trial_ends_at" type="date" defaultValue={billing.trial_ends_at ?? ""} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Observações internas" htmlFor="b-notes">
          <Textarea id="b-notes" name="notes" maxLength={500} rows={2} defaultValue={notes} />
        </Field>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar assinatura"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function PaymentForm({ slug, defaultMonth, defaultAmountCents, today }: { slug: string; defaultMonth: string; defaultAmountCents: number; today: string }) {
  const [state, action, pending] = useActionState(recordPayment.bind(null, slug), undefined);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Mês de referência" htmlFor="p-month">
        <Input id="p-month" name="reference_month" type="month" defaultValue={defaultMonth} required />
      </Field>
      <Field label="Valor recebido (R$)" htmlFor="p-amount">
        <Input id="p-amount" name="amount" inputMode="decimal" defaultValue={defaultAmountCents ? centsToInput(defaultAmountCents) : ""} required />
      </Field>
      <Field label="Pago em" htmlFor="p-paid">
        <Input id="p-paid" name="paid_at" type="date" defaultValue={today} max={today} required />
      </Field>
      <Field label="Forma de pagamento" htmlFor="p-method">
        <Select id="p-method" name="method" defaultValue="pix" className="w-full">
          {Object.entries(paymentMethods).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Observação" htmlFor="p-notes">
          <Input id="p-notes" name="notes" maxLength={280} />
        </Field>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Registrar pagamento"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function PaymentSettingsForm({
  slug,
  initial,
}: {
  slug: string;
  initial: { enabled: boolean; recipientId: string; platformFeePercent: number };
}) {
  const [state, action, pending] = useActionState(savePaymentSettings.bind(null, slug), undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} />
        Aceitar pagamento online (Pix e cartão) no cardápio
      </label>
      <Field label="Recebedor do estabelecimento no Pagar.me" htmlFor="pg-recipient" hint="ID do recebedor (rp_...) cadastrado no Pagar.me com a conta bancária do estabelecimento. O valor de cada pagamento vai para ele.">
        <Input id="pg-recipient" name="recipient_id" defaultValue={initial.recipientId} placeholder="rp_..." autoComplete="off" />
      </Field>
      <Field label="Comissão da PedeAe (%)" htmlFor="pg-fee" hint="Parte de cada pagamento online que vai para o recebedor da PedeAe (PAGARME_PLATFORM_RECIPIENT_ID). 0 = sem comissão.">
        <Input id="pg-fee" name="platform_fee_percent" type="number" min={0} max={20} step={1} defaultValue={initial.platformFeePercent} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar pagamento online"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
