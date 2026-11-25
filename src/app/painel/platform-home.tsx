import Link from "next/link";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { billingStatus, monthlyRecurringRevenue, plans, type Billing } from "@/lib/billing";
import { formatBRL } from "@/lib/money";
import { businessToday } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";
import { PlatformCreateOrganizationForm } from "./platform-forms";
import { setOrganizationStatus } from "./platform-actions";

const statusInfo = {
  active: { label: "Ativo", tone: "success" },
  suspended: { label: "Suspenso", tone: "warning" },
  cancelled: { label: "Cancelado", tone: "danger" },
} as const;
type OrgStatus = keyof typeof statusInfo;

/** Visão do dono do SaaS: todos os estabelecimentos da plataforma. */
export async function PlatformHome() {
  const supabase = await createClient();
  const today = businessToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [{ data: orgs }, { data: billingRows }, { data: payments }, { data: overview }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, status, created_at").order("created_at", { ascending: false }),
    supabase.from("organization_billing").select("organization_id, plan, monthly_price_cents, due_day, trial_ends_at"),
    supabase.from("billing_payments").select("organization_id, reference_month, amount_cents, paid_at"),
    supabase.rpc("platform_overview"),
  ]);

  type Stats = { organization_id: string; orders_30d: number; revenue_30d_cents: number; products: number; members: number };
  const stats = new Map(((overview ?? []) as Stats[]).map((s) => [s.organization_id, s]));
  const billingByOrg = new Map((billingRows ?? []).map((b) => [b.organization_id, b as Billing & { organization_id: string }]));

  const list = (orgs ?? []).map((o) => {
    const billing = billingByOrg.get(o.id) ?? null;
    const paid = (payments ?? []).filter((p) => p.organization_id === o.id).map((p) => p.reference_month);
    return {
      ...o,
      status: o.status as OrgStatus,
      billing,
      situation: billing ? billingStatus(billing, paid, today, o.created_at) : null,
      stats: stats.get(o.id),
    };
  });
  const active = list.filter((o) => o.status === "active").length;
  const mrr = monthlyRecurringRevenue(list);
  const overdue = list.filter((o) => o.status === "active" && o.situation?.key === "em_atraso").length;
  const receivedThisMonth = (payments ?? []).filter((p) => p.paid_at >= monthStart).reduce((n, p) => n + p.amount_cents, 0);
  const gmv = list.reduce((n, o) => n + (o.stats?.revenue_30d_cents ?? 0), 0);

  return (
    <main className="mx-auto grid w-full max-w-6xl items-start gap-6 px-4 py-8 lg:grid-cols-[1fr_22rem]">
      <section>
        <PageHeader
          title="Administração da plataforma"
          description={`${list.length} estabelecimento(s) · ${active} ativo(s). Você tem acesso de administrador em todos.`}
          actions={
            <>
              <Link href="/painel/catalogo" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-hover">
                Catálogo base (fotos)
              </Link>
              <Link href="/painel/recebedores" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-hover">
                Recebedores e KYC (Pagar.me)
              </Link>
            </>
          }
        />
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Receita mensal (MRR)" value={formatBRL(mrr)} note="Planos pagos de estabelecimentos ativos" />
          <Kpi label="Recebido no mês" value={formatBRL(receivedThisMonth)} />
          <Kpi label="Em atraso" value={String(overdue)} note={overdue ? "Veja a lista abaixo" : "Nenhum estabelecimento"} />
          <Kpi label="Vendas dos clientes (30 dias)" value={formatBRL(gmv)} note="Soma dos pedidos aceitos" />
        </div>

        {list.length === 0 ? (
          <EmptyState title="Nenhum estabelecimento ainda">Cadastre o primeiro cliente ao lado.</EmptyState>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {list.map((org) => (
                <li key={org.id} className="flex flex-wrap items-center gap-3 p-4">
                  <Link href={`/painel/${org.slug}`} className="min-w-0 flex-1 hover:underline">
                    <p className="flex items-center gap-2 font-medium">
                      {org.name}
                      <Badge tone={statusInfo[org.status].tone}>{statusInfo[org.status].label}</Badge>
                    </p>
                    <p className="text-sm text-muted">
                      /m/{org.slug} · {org.stats?.members ?? 0} usuário(s) · {org.stats?.products ?? 0} produto(s) · desde{" "}
                      {new Date(org.created_at).toLocaleDateString("pt-BR")}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      {org.billing && (
                        <span className="text-muted">
                          {plans[org.billing.plan].label}
                          {plans[org.billing.plan].paid && ` · ${formatBRL(org.billing.monthly_price_cents)}/mês`}
                        </span>
                      )}
                      {org.situation && <Badge tone={org.situation.tone}>{org.situation.label}</Badge>}
                      <span className="text-muted">
                        Últimos 30 dias: {org.stats?.orders_30d ?? 0} pedido(s), {formatBRL(org.stats?.revenue_30d_cents ?? 0)}
                      </span>
                    </p>
                  </Link>
                  <div className="flex gap-1">
                    {org.status === "active" ? (
                      <form action={setOrganizationStatus.bind(null, org.id, "suspended")}>
                        <Button type="submit" variant="ghost" className="h-8 px-3 text-warning">
                          Suspender
                        </Button>
                      </form>
                    ) : (
                      <form action={setOrganizationStatus.bind(null, org.id, "active")}>
                        <Button type="submit" variant="ghost" className="h-8 px-3 text-success">
                          Reativar
                        </Button>
                      </form>
                    )}
                    <Link href={`/painel/${org.slug}/assinatura`} className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium hover:bg-hover">
                      Assinatura
                    </Link>
                    <Link href={`/painel/${org.slug}`} className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium hover:bg-hover">
                      Gerenciar
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="mt-3 text-xs text-muted">
          Estabelecimento suspenso some do cardápio público e para de receber pedidos dos clientes. A equipe continua
          acessando o painel.
        </p>
      </section>

      <aside>
        <Card>
          <h2 className="mb-1 font-semibold">Novo estabelecimento</h2>
          <p className="mb-4 text-sm text-muted">Depois de criar, cadastre o administrador do cliente na tela de Equipe.</p>
          <PlatformCreateOrganizationForm />
        </Card>
      </aside>
    </main>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </Card>
  );
}
