import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { startOfBusinessDay } from "@/lib/order-metrics";
import { activeStatuses, type OrderStatus } from "@/lib/orders";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { OrderCard, type PanelOrder } from "./order-card";

export const metadata: Metadata = { title: "Pedidos" };

const FILTERS = {
  ativos: { label: "Em andamento", statuses: activeStatuses },
  hoje: { label: "Todos de hoje", statuses: null },
  encerrados: { label: "Encerrados hoje", statuses: ["delivered", "cancelled", "rejected"] as OrderStatus[] },
} as const;
type FilterKey = keyof typeof FILTERS;

export default async function OrdersPage({ params, searchParams }: PageProps<"/painel/[slug]/pedidos">) {
  const { slug } = await params;
  const { filtro } = await searchParams;
  const filter: FilterKey = typeof filtro === "string" && filtro in FILTERS ? (filtro as FilterKey) : "ativos";
  const { organization, membership } = await requirePermission(slug, "view_orders");
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      `id, order_number, status, source, customer_name, notes, total_cents, created_at,
       tables (name),
       order_items (id, product_name_snapshot, quantity, notes, sort_order, order_item_options (item_name_snapshot))`,
    )
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: filter === "ativos" })
    .limit(200);

  const statuses = FILTERS[filter].statuses;
  if (statuses) query = query.in("status", statuses);
  // Pedidos ativos aparecem mesmo se vierem de ontem (não podem sumir da fila).
  if (filter !== "ativos") query = query.gte("created_at", startOfBusinessDay());

  const { data } = await query;

  const orders: PanelOrder[] = (data ?? []).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    status: o.status as OrderStatus,
    source: o.source as PanelOrder["source"],
    customer_name: o.customer_name,
    notes: o.notes,
    total_cents: o.total_cents,
    created_at: o.created_at,
    table_name: (o.tables as unknown as { name: string } | null)?.name ?? null,
    items: [...(o.order_items ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({
        id: i.id,
        name: i.product_name_snapshot,
        quantity: i.quantity,
        notes: i.notes,
        options: (i.order_item_options ?? []).map((op) => op.item_name_snapshot),
      })),
  }));

  const pending = orders.filter((o) => o.status === "pending_confirmation").length;
  const canCancel = can(membership, "cancel_orders");
  const totalShown = orders.filter((o) => o.status !== "cancelled" && o.status !== "rejected").reduce((n, o) => n + o.total_cents, 0);

  return (
    <>
      <AutoRefresh active intervalMs={15000} />
      <PageHeader
        title="Pedidos"
        description={
          filter === "ativos"
            ? `${orders.length} em andamento${pending ? ` · ${pending} aguardando confirmação` : ""}. Atualiza a cada 15 s.`
            : `${orders.length} pedido(s) · ${formatBRL(totalShown)}`
        }
        actions={
          can(membership, "create_manual_order") && <ButtonLink href={`/painel/${slug}/pedidos/novo`}>Lançar pedido</ButtonLink>
        }
      />

      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Filtros">
        {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
          <Link
            key={key}
            href={`/painel/${slug}/pedidos?filtro=${key}`}
            aria-current={filter === key ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              filter === key ? "bg-brand text-brand-contrast" : "bg-surface-2 text-muted hover:text-text"
            }`}
          >
            {FILTERS[key].label}
          </Link>
        ))}
      </nav>

      {orders.length === 0 ? (
        <EmptyState title={filter === "ativos" ? "Nenhum pedido em andamento" : "Nenhum pedido hoje"}>
          Os pedidos feitos pelo QR Code das mesas aparecem aqui.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <OrderCard key={order.id} slug={slug} order={order} canCancel={canCancel} />
          ))}
        </div>
      )}
    </>
  );
}
