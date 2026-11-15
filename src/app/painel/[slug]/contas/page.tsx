import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrdersLive } from "@/components/orders-live";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { startOfBusinessDay } from "@/lib/order-metrics";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { computeTab, countsInTab } from "@/lib/tab";

export const metadata: Metadata = { title: "Contas" };

type SessionRow = {
  id: string;
  table_id: string;
  opened_at: string;
  closed_at: string | null;
  total_cents: number | null;
  tables: { name: string; sort_order: number } | null;
  orders: { total_cents: number; status: string }[];
  tab_payments: { amount_cents: number }[];
};

const time = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit" });
const ACTIVE = ["pending_confirmation", "received", "preparing", "ready"];

/** Contas abertas das mesas e as fechadas hoje. */
export default async function TabsPage({ params, searchParams }: PageProps<"/painel/[slug]/contas">) {
  const { slug } = await params;
  const { mesa } = await searchParams;
  const { organization, membership } = await getOrgContext(slug);
  if (!can(membership, "receive_payments") && !can(membership, "close_tabs")) notFound();

  const supabase = await createClient();
  const select = "id, table_id, opened_at, closed_at, total_cents, tables (name, sort_order), orders (total_cents, status), tab_payments (amount_cents)";
  const [{ data: open }, { data: closed }, { data: calls }] = await Promise.all([
    supabase.from("table_sessions").select(select).eq("organization_id", organization.id).eq("status", "open"),
    supabase
      .from("table_sessions")
      .select(select)
      .eq("organization_id", organization.id)
      .eq("status", "closed")
      .gte("closed_at", startOfBusinessDay())
      .order("closed_at", { ascending: false }),
    supabase.from("service_calls").select("table_id").eq("organization_id", organization.id).eq("status", "open").eq("kind", "bill"),
  ]);

  const openList = ((open ?? []) as unknown as SessionRow[]).sort(
    (a, b) => (a.tables?.sort_order ?? 0) - (b.tables?.sort_order ?? 0) || (a.tables?.name ?? "").localeCompare(b.tables?.name ?? ""),
  );
  // Vindo do aviso "pediu a conta": vai direto para a conta da mesa.
  if (typeof mesa === "string") {
    const target = openList.find((s) => s.table_id === mesa);
    if (target) redirect(`/painel/${slug}/contas/${target.id}`);
  }
  const askedBill = new Set((calls ?? []).map((c) => c.table_id));
  const closedList = (closed ?? []) as unknown as SessionRow[];
  const closedTotal = closedList.reduce((n, s) => n + (s.total_cents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Contas"
        description={`${openList.length} mesa(s) com conta aberta. A conta abre sozinha no primeiro pedido da mesa.`}
        actions={<OrdersLive orgId={organization.id} />}
      />

      {openList.length === 0 ? (
        <EmptyState title="Nenhuma conta aberta">Quando uma mesa fizer o primeiro pedido, a conta dela aparece aqui.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {openList.map((s) => {
            const t = computeTab(
              s.orders.filter((o) => countsInTab(o.status)).map((o) => o.total_cents),
              s.tab_payments.map((p) => p.amount_cents),
              0,
            );
            const active = s.orders.filter((o) => ACTIVE.includes(o.status)).length;
            return (
              <Link key={s.id} href={`/painel/${slug}/contas/${s.id}`}>
                <Card className="flex h-full flex-col gap-2 transition hover:border-border-strong">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-lg font-bold">{s.tables?.name ?? "Mesa"}</p>
                    {askedBill.has(s.table_id) && <Badge tone="warning">pediu a conta</Badge>}
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{formatBRL(t.subtotalCents)}</p>
                  <p className="text-sm text-muted">
                    Aberta às {time.format(new Date(s.opened_at))} · {s.orders.filter((o) => countsInTab(o.status)).length} pedido(s)
                    {active > 0 && ` · ${active} em andamento`}
                  </p>
                  {t.paidCents > 0 && <p className="text-sm text-success">Recebido: {formatBRL(t.paidCents)}</p>}
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {closedList.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold">
            Fechadas hoje · <span className="text-muted">{formatBRL(closedTotal)}</span>
          </h2>
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {closedList.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 font-medium">{s.tables?.name ?? "Mesa"}</span>
                  <span className="text-sm text-muted">{s.closed_at && `fechada às ${time.format(new Date(s.closed_at))}`}</span>
                  <span className="font-semibold tabular-nums">{formatBRL(s.total_cents ?? 0)}</span>
                  <a href={`/imprimir/${slug}/conta/${s.id}`} target="_blank" rel="noopener" className="text-sm font-medium text-brand-text hover:underline">
                    Cupom
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}
