import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { billingStatus, paymentMethods, plans, type Billing, type PaymentMethod } from "@/lib/billing";
import { formatBRL } from "@/lib/money";
import { businessToday } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";
import { deletePayment } from "./actions";
import { BillingForm, PaymentForm, PaymentSettingsForm } from "./billing-forms";
import { paymentsConfigured, simulatorEnabled } from "@/lib/payments/service";

export const metadata: Metadata = { title: "Assinatura" };

const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const monthTitle = (m: string) => {
  const s = monthName.format(new Date(`${m}T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const dateBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Plano, mensalidade e pagamentos do estabelecimento. Somente Admin Geral. */
export default async function SubscriptionPage({ params }: PageProps<"/painel/[slug]/assinatura">) {
  const { slug } = await params;
  const { organization, isPlatformAdmin } = await getOrgContext(slug);
  if (!isPlatformAdmin) notFound();

  const supabase = await createClient();
  const [{ data: row }, { data: payments }, { data: org }, { data: online }] = await Promise.all([
    supabase.from("organization_billing").select("plan, monthly_price_cents, due_day, trial_ends_at, notes").eq("organization_id", organization.id).maybeSingle(),
    supabase
      .from("billing_payments")
      .select("id, reference_month, amount_cents, paid_at, method, notes")
      .eq("organization_id", organization.id)
      .order("reference_month", { ascending: false }),
    supabase.from("organizations").select("created_at").eq("id", organization.id).single(),
    supabase.from("organization_payment_settings").select("enabled, pagarme_recipient_id, platform_fee_percent").eq("organization_id", organization.id).maybeSingle(),
  ]);
  const serverReady = paymentsConfigured();
  const simulator = simulatorEnabled();

  const billing: Billing = {
    plan: (row?.plan ?? "trial") as Billing["plan"],
    monthly_price_cents: row?.monthly_price_cents ?? 0,
    due_day: row?.due_day ?? 10,
    trial_ends_at: row?.trial_ends_at ?? null,
  };
  const today = businessToday();
  const list = payments ?? [];
  const status = billingStatus(billing, list.map((p) => p.reference_month), today, org?.created_at ?? today);
  const totalPaid = list.reduce((n, p) => n + p.amount_cents, 0);

  return (
    <>
      <PageHeader
        title="Assinatura"
        description="Plano e pagamentos deste estabelecimento com a PedeAe. Visível só para a administração da plataforma."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Situação</p>
          <p>
            <Badge tone={status.tone}>{status.label}</Badge>
          </p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Plano</p>
          <p className="text-xl font-semibold">
            {plans[billing.plan].label}
            {plans[billing.plan].paid && <span className="text-base font-normal text-muted"> · {formatBRL(billing.monthly_price_cents)}/mês</span>}
          </p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Total recebido</p>
          <p className="text-xl font-semibold tabular-nums">{formatBRL(totalPaid)}</p>
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Plano</h2>
          <BillingForm slug={slug} billing={billing} notes={row?.notes ?? ""} />
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">Registrar pagamento</h2>
          <p className="mb-4 text-sm text-muted">Use quando receber a mensalidade (Pix, boleto etc.). Um pagamento por mês.</p>
          <PaymentForm
            slug={slug}
            defaultMonth={(status.dueMonth ?? `${today.slice(0, 7)}-01`).slice(0, 7)}
            defaultAmountCents={billing.monthly_price_cents}
            today={today}
          />
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-1 font-semibold">Pagamento online (Pagar.me)</h2>
        <p className="mb-4 text-sm text-muted">
          Os clientes pagam com Pix ou cartão pelo cardápio (na mesa, antes do pedido ou por link). O dinheiro é dividido pelo split do Pagar.me direto para o recebedor do estabelecimento.
        </p>
        {!serverReady && (
          <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            O servidor ainda não tem as chaves do Pagar.me e do Supabase configuradas (PAGARME_SECRET_KEY, NEXT_PUBLIC_PAGARME_PUBLIC_KEY, SUPABASE_SECRET_KEY). Mesmo ativado aqui, o cardápio não oferece pagamento online até isso ser feito.
          </p>
        )}
        {serverReady && simulator && (
          <p className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">Modo simulador: nenhum pagamento é real.</p>
        )}
        <PaymentSettingsForm
          slug={slug}
          initial={{
            enabled: online?.enabled ?? false,
            recipientId: online?.pagarme_recipient_id ?? "",
            platformFeePercent: online?.platform_fee_percent ?? 0,
          }}
        />
      </Card>

      <Card className="mt-6 p-0">
        <h2 className="p-4 pb-2 font-semibold">Pagamentos</h2>
        {list.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">Nenhum pagamento registrado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{monthTitle(p.reference_month)}</p>
                  <p className="text-sm text-muted">
                    {paymentMethods[p.method as PaymentMethod] ?? p.method} · pago em {dateBR(p.paid_at)}
                    {p.notes && ` · ${p.notes}`}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{formatBRL(p.amount_cents)}</span>
                <form action={deletePayment.bind(null, slug, p.id)}>
                  <Button type="submit" variant="ghost" className="h-8 px-3 text-danger">
                    Excluir
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
