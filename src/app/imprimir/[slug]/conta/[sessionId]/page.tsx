import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { computeTab, countsInTab, DEFAULT_SERVICE_FEE, paymentMethods, type TabPaymentMethod } from "@/lib/tab";
import { AutoPrint } from "../../../auto-print";

export const metadata: Metadata = { title: "Cupom da conta", robots: { index: false } };

const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Momento da impressão (a conferência parcial mostra a hora em que foi impressa). */
const printedAt = () => new Date();

type Item = { product_name_snapshot: string; quantity: number; line_total_cents: number };

/** Cupom da conta da mesa (não fiscal): itens somados, taxa, descontos, pagamentos e troco. */
// Depende da sessão: fica atrás de <Suspense> (exigência do Next 16 para dados da requisição).
export default function TabReceiptPage({ params }: PageProps<"/imprimir/[slug]/conta/[sessionId]">) {
  return (
    <Suspense fallback={<p style={{ textAlign: "center", font: "14px system-ui", padding: 24 }}>Preparando impressão…</p>}>
      <TabReceipt params={params} />
    </Suspense>
  );
}

async function TabReceipt({ params }: { params: PageProps<"/imprimir/[slug]/conta/[sessionId]">["params"] }) {
  const { slug, sessionId } = await params;
  const { organization, membership } = await getOrgContext(slug);
  if (!can(membership, "receive_payments") && !can(membership, "close_tabs")) notFound();
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) notFound();

  const supabase = await createClient();
  const { data: s } = await supabase
    .from("table_sessions")
    .select(
      `status, opened_at, closed_at, service_fee_percent, tables (name),
       orders (status, total_cents, discount_cents, coupon_code, order_items (product_name_snapshot, quantity, line_total_cents)),
       tab_payments (amount_cents, method)`,
    )
    .eq("organization_id", organization.id)
    .eq("id", sessionId)
    .maybeSingle();
  if (!s) notFound();

  const orders = (s.orders ?? []).filter((o) => countsInTab(o.status));
  // Itens iguais (mesmo nome e preço unitário) viram uma linha só.
  const lines = new Map<string, { name: string; qty: number; total: number }>();
  for (const o of orders) {
    for (const i of (o.order_items ?? []) as Item[]) {
      const key = `${i.product_name_snapshot}|${i.line_total_cents / i.quantity}`;
      const l = lines.get(key) ?? { name: i.product_name_snapshot, qty: 0, total: 0 };
      l.qty += i.quantity;
      l.total += i.line_total_cents;
      lines.set(key, l);
    }
  }
  const discounts = orders.filter((o) => o.discount_cents > 0);
  const isOpen = s.status === "open";
  const fee = isOpen ? DEFAULT_SERVICE_FEE : Number(s.service_fee_percent);
  const t = computeTab(orders.map((o) => o.total_cents), (s.tab_payments ?? []).map((p) => p.amount_cents), fee);
  const table = (s.tables as unknown as { name: string } | null)?.name ?? "Mesa";

  return (
    <>
      <article className="ticket">
        <h1>{organization.name}</h1>
        <p className="center muted">{isOpen ? "CONFERÊNCIA DA CONTA (PARCIAL)" : "CUPOM DA CONTA"}</p>
        <hr />
        <div className="row">
          <strong>{table}</strong>
          <span>{when.format(isOpen ? printedAt() : new Date(s.closed_at ?? s.opened_at))}</span>
        </div>
        <hr />
        <ul>
          {[...lines.values()].map((l) => (
            <li key={l.name + l.total} className="row">
              <span>
                {l.qty}x {l.name}
              </span>
              <span>{formatBRL(l.total)}</span>
            </li>
          ))}
        </ul>
        {discounts.map((o, n) => (
          <div key={n} className="row">
            <span>Desconto {o.coupon_code}</span>
            <span>-{formatBRL(o.discount_cents)}</span>
          </div>
        ))}
        <hr />
        <div className="row">
          <span>Consumo</span>
          <span>{formatBRL(t.subtotalCents)}</span>
        </div>
        {fee > 0 && (
          <div className="row">
            <span>Serviço ({fee}%){isOpen && " sugerido"}</span>
            <span>{formatBRL(t.serviceFeeCents)}</span>
          </div>
        )}
        <div className="row big" style={{ fontSize: 16 }}>
          <span>TOTAL</span>
          <span>{formatBRL(t.totalCents)}</span>
        </div>
        {(s.tab_payments ?? []).length > 0 && (
          <>
            <hr />
            {(s.tab_payments ?? []).map((p, n) => (
              <div key={n} className="row">
                <span>{paymentMethods[p.method as TabPaymentMethod] ?? p.method}</span>
                <span>{formatBRL(p.amount_cents)}</span>
              </div>
            ))}
            {isOpen && t.remainingCents > 0 && (
              <div className="row" style={{ fontWeight: 700 }}>
                <span>Falta pagar</span>
                <span>{formatBRL(t.remainingCents)}</span>
              </div>
            )}
          </>
        )}
        <hr />
        <p className="center muted">Obrigado pela visita!</p>
        <p className="center muted" style={{ fontSize: 10 }}>
          Não é documento fiscal · PedeAe
        </p>
      </article>
      <AutoPrint />
    </>
  );
}
