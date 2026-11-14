import Link from "next/link";
import { OrdersLive } from "@/components/orders-live";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { elapsedLabel, startOfBusinessDay, summarizeOrders } from "@/lib/order-metrics";
import { activeStatuses, nextStatuses, orderStatusLabels, orderStatusTone, type OrderStatus } from "@/lib/orders";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_THEME } from "@/lib/themes";
import { StatusButton } from "./pedidos/order-card";

const QUEUE_PREVIEW = 12;

export default async function OrgDashboardPage({ params }: PageProps<"/painel/[slug]">) {
  const { slug } = await params;
  const { organization, membership } = await getOrgContext(slug);
  const supabase = await createClient();

  const [
    { data: settings },
    { count: memberCount },
    { count: productCount },
    { count: tableCount },
    { data: activeOrders },
    { data: todayOrders },
  ] = await Promise.all([
    supabase
      .from("organization_settings")
      .select("theme, settings, logo_path")
      .eq("organization_id", organization.id)
      .single(),
    supabase.from("memberships").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
    supabase.from("tables").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
    supabase
      .from("orders")
      .select(
        "id, order_number, status, customer_name, total_cents, created_at, tables (name), order_items (product_name_snapshot, quantity, sort_order)",
      )
      .eq("organization_id", organization.id)
      .in("status", activeStatuses)
      .order("created_at")
      .limit(200),
    supabase
      .from("orders")
      .select("status, total_cents, created_at")
      .eq("organization_id", organization.id)
      .gte("created_at", startOfBusinessDay())
      .limit(1000),
  ]);

  // Personalizada = algo diferente dos padrões da migration.
  const brandCustomized =
    !!settings &&
    (settings.theme !== DEFAULT_THEME ||
      (settings.settings as Record<string, unknown> | null)?.custom_colors === true ||
      !!settings.logo_path);

  // Só o que falta fazer e que esta pessoa consegue fazer.
  const pendingSteps = [
    {
      done: brandCustomized,
      label: "Personalize a marca e o tema",
      allowed: can(membership, "manage_brand"),
      href: `/painel/${slug}/configuracoes`,
    },
    {
      done: (productCount ?? 0) > 0,
      label: "Cadastre categorias e produtos do cardápio",
      allowed: can(membership, "manage_menu"),
      href: `/painel/${slug}/cardapio`,
    },
    {
      done: (tableCount ?? 0) > 0,
      label: "Crie as mesas e imprima os QR Codes",
      allowed: can(membership, "manage_tables"),
      href: `/painel/${slug}/mesas`,
    },
    {
      done: (memberCount ?? 0) > 1,
      label: "Convide sua equipe",
      allowed: can(membership, "manage_team"),
      href: `/painel/${slug}/equipe`,
    },
  ].filter((step) => !step.done && step.allowed);

  const active = (activeOrders ?? []).map((o) => ({ ...o, status: o.status as OrderStatus }));
  const metrics = summarizeOrders(
    active,
    (todayOrders ?? []).map((o) => ({ ...o, status: o.status as OrderStatus })),
  );
  const canSeeSales = can(membership, "view_reports");
  const queue = active.slice(0, QUEUE_PREVIEW);

  return (
    <>
      <PageHeader
        title={organization.name}
        description="Visão de hoje. Pedidos chegam em tempo real."
        actions={
          <>
            {can(membership, "view_orders") && <OrdersLive orgId={organization.id} />}
            <ButtonLink href={`/m/${slug}`} target="_blank" variant="secondary">
              Ver cardápio público
            </ButtonLink>
            {can(membership, "create_manual_order") && <ButtonLink href={`/painel/${slug}/pedidos/novo`}>Lançar pedido</ButtonLink>}
          </>
        }
      />

      {pendingSteps.length > 0 && (
        <section className="mb-6" aria-labelledby="primeiros-passos">
          <h2 id="primeiros-passos" className="mb-3 font-semibold">
            Primeiros passos
          </h2>
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {pendingSteps.map((step) => (
                <li key={step.label} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="text-sm">{step.label}</span>
                  <Link href={step.href} className="text-sm font-medium text-brand-text hover:underline">
                    Abrir
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section aria-label="Indicadores de hoje" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Na fila" value={metrics.queued} highlight={metrics.queued > 0} />
        <Metric label="Em preparo" value={metrics.preparing} />
        <Metric label="Prontos para entregar" value={metrics.ready} />
        <Metric label="Atendidos hoje" value={metrics.deliveredToday} />
        <Metric label="Pedidos hoje" value={metrics.ordersToday} />
        <Metric label="Maior espera" value={metrics.oldestActiveAt ? elapsedLabel(metrics.oldestActiveAt) : "—"} />
        <Metric label="Cancelados e recusados" value={metrics.lostToday} />
        {canSeeSales && <Metric label="Valor dos pedidos hoje" value={formatBRL(metrics.salesTodayCents)} />}
        {canSeeSales && <Metric label="Ticket médio" value={formatBRL(metrics.averageTicketCents)} />}
      </section>

      <section className="mt-8" aria-labelledby="fila">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="fila" className="font-semibold">
            Fila de pedidos
          </h2>
          <Link href={`/painel/${slug}/pedidos`} className="text-sm font-medium text-brand-text hover:underline">
            {active.length > QUEUE_PREVIEW ? `Ver todos (${active.length})` : "Ver pedidos"}
          </Link>
        </div>

        {queue.length === 0 ? (
          <EmptyState title="Nenhum pedido em andamento">Os novos pedidos aparecem aqui, começando pelo mais antigo.</EmptyState>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {queue.map((order) => {
              const items = [...(order.order_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
              // A primeira transição é sempre o avanço normal; cancelar e recusar ficam na tela de Pedidos.
              const next = nextStatuses[order.status][0];
              return (
                <li key={order.id}>
                  <Card className="flex h-full flex-col gap-2 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold">#{order.order_number}</p>
                        <p className="truncate text-xs text-muted">
                          {(order.tables as unknown as { name: string } | null)?.name ?? "Sem mesa"}
                          {order.customer_name && ` · ${order.customer_name}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={orderStatusTone[order.status]}>{orderStatusLabels[order.status]}</Badge>
                        <span className="text-xs text-muted">{elapsedLabel(order.created_at)}</span>
                      </div>
                    </div>
                    <p className="line-clamp-2 flex-1 text-sm text-muted">
                      {items.map((i) => `${i.quantity}× ${i.product_name_snapshot}`).join(", ")}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{formatBRL(order.total_cents)}</span>
                      <StatusButton slug={slug} orderId={order.id} to={next} />
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

function Metric({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <Card className={`flex flex-col gap-1 p-4 ${highlight ? "border-warning" : ""}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}
