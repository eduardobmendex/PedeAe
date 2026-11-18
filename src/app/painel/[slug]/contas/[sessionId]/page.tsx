import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrdersLive } from "@/components/orders-live";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { orderStatusLabels, orderStatusTone, type OrderStatus } from "@/lib/orders";
import { can } from "@/lib/permissions";
import { paymentsConfigured } from "@/lib/payments/service";
import { createClient } from "@/lib/supabase/server";
import { countsInTab, DEFAULT_SERVICE_FEE } from "@/lib/tab";
import { TabPanel } from "./tab-panel";

export const metadata: Metadata = { title: "Conta da mesa" };

const time = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit" });

type Order = {
  id: string;
  order_number: number;
  status: OrderStatus;
  total_cents: number;
  discount_cents: number;
  coupon_code: string | null;
  created_at: string;
  order_items: { id: string; product_name_snapshot: string; quantity: number; line_total_cents: number; sort_order: number }[];
};

export default async function TabPage({ params }: PageProps<"/painel/[slug]/contas/[sessionId]">) {
  const { slug, sessionId } = await params;
  const { organization, membership } = await getOrgContext(slug);
  if (!can(membership, "receive_payments") && !can(membership, "close_tabs")) notFound();
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) notFound();

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("table_sessions")
    .select(
      `id, status, opened_at, closed_at, service_fee_percent, total_cents, tables (name),
       orders (id, order_number, status, total_cents, discount_cents, coupon_code, created_at,
         order_items (id, product_name_snapshot, quantity, line_total_cents, sort_order)),
       tab_payments (id, amount_cents, method, created_at, payment_intent_id)`,
    )
    .eq("organization_id", organization.id)
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) notFound();

  const { data: online } = await supabase.from("organization_payment_settings").select("enabled").eq("organization_id", organization.id).maybeSingle();
  const onlinePayments = online?.enabled === true && paymentsConfigured();
  const orders = ([...(session.orders ?? [])] as unknown as Order[]).sort((a, b) => a.order_number - b.order_number);
  const tableName = (session.tables as unknown as { name: string } | null)?.name ?? "Mesa";
  const isOpen = session.status === "open";
  const activeOrders = orders.filter((o) => ["pending_confirmation", "received", "preparing", "ready"].includes(o.status)).length;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/painel/${slug}/contas`} className="text-muted hover:text-text hover:underline">
          ← Contas
        </Link>
      </p>
      <PageHeader
        title={`Conta · ${tableName}`}
        description={
          isOpen
            ? `Aberta às ${time.format(new Date(session.opened_at))}.`
            : `Fechada às ${session.closed_at ? time.format(new Date(session.closed_at)) : ""}.`
        }
        actions={
          <>
            {isOpen && <OrdersLive orgId={organization.id} />}
            <a
              href={`/imprimir/${slug}/conta/${session.id}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium hover:bg-hover"
            >
              {isOpen ? "Imprimir parcial" : "Imprimir cupom"}
            </a>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <Card className="p-0">
          <h2 className="p-4 pb-2 font-semibold">Pedidos</h2>
          {orders.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">Nenhum pedido nesta conta.</p>
          ) : (
            <ul className="divide-y divide-border">
              {orders.map((o) => {
                const counts = countsInTab(o.status);
                return (
                  <li key={o.id} className={`px-4 py-3 ${counts ? "" : "opacity-50"}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-semibold">#{o.order_number}</span>
                      <span className="text-sm text-muted">{time.format(new Date(o.created_at))}</span>
                      <Badge tone={orderStatusTone[o.status]}>{orderStatusLabels[o.status]}</Badge>
                      <span className={`ml-auto font-semibold tabular-nums ${counts ? "" : "line-through"}`}>{formatBRL(o.total_cents)}</span>
                    </div>
                    <ul className="text-sm text-muted">
                      {[...o.order_items]
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((i) => (
                          <li key={i.id} className="flex justify-between gap-3">
                            <span>
                              {i.quantity}× {i.product_name_snapshot}
                            </span>
                            <span className="tabular-nums">{formatBRL(i.line_total_cents)}</span>
                          </li>
                        ))}
                      {o.discount_cents > 0 && (
                        <li className="flex justify-between gap-3 text-success">
                          <span>Cupom {o.coupon_code}</span>
                          <span className="tabular-nums">− {formatBRL(o.discount_cents)}</span>
                        </li>
                      )}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <TabPanel
          slug={slug}
          sessionId={session.id}
          isOpen={isOpen}
          activeOrders={activeOrders}
          orderTotals={orders.filter((o) => countsInTab(o.status)).map((o) => o.total_cents)}
          payments={(session.tab_payments ?? []) as { id: string; amount_cents: number; method: string; created_at: string; payment_intent_id: string | null }[]}
          initialFee={isOpen ? DEFAULT_SERVICE_FEE : Number(session.service_fee_percent)}
          canReceive={can(membership, "receive_payments")}
          canClose={can(membership, "close_tabs")}
          onlinePayments={onlinePayments}
        />
      </div>
    </>
  );
}
