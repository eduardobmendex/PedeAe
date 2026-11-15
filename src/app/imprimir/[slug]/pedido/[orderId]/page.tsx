import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AutoPrint } from "../../../auto-print";

export const metadata: Metadata = { title: "Comanda", robots: { index: false } };

const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Comanda da cozinha: só o que a cozinha precisa (sem preços). */
// Depende da sessão: fica atrás de <Suspense> (exigência do Next 16 para dados da requisição).
export default function KitchenTicketPage({ params }: PageProps<"/imprimir/[slug]/pedido/[orderId]">) {
  return (
    <Suspense fallback={<p style={{ textAlign: "center", font: "14px system-ui", padding: 24 }}>Preparando impressão…</p>}>
      <KitchenTicket params={params} />
    </Suspense>
  );
}

async function KitchenTicket({ params }: { params: PageProps<"/imprimir/[slug]/pedido/[orderId]">["params"] }) {
  const { slug, orderId } = await params;
  const { organization } = await requirePermission(slug, "view_orders");
  if (!/^[0-9a-f-]{36}$/.test(orderId)) notFound();

  const supabase = await createClient();
  const { data: o } = await supabase
    .from("orders")
    .select(
      `order_number, customer_name, notes, created_at, source, tables (name),
       order_items (id, product_name_snapshot, quantity, notes, sort_order, order_item_options (option_name_snapshot, item_name_snapshot))`,
    )
    .eq("organization_id", organization.id)
    .eq("id", orderId)
    .maybeSingle();
  if (!o) notFound();

  const items = [...(o.order_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const table = (o.tables as unknown as { name: string } | null)?.name ?? "Balcão";

  return (
    <>
      <article className="ticket">
        <h1>{organization.name}</h1>
        <p className="center muted">COMANDA DA COZINHA</p>
        <hr />
        <div className="row">
          <span className="big">#{o.order_number}</span>
          <span className="big">{table}</span>
        </div>
        <p className="muted">
          {when.format(new Date(o.created_at))}
          {o.customer_name && ` · ${o.customer_name}`}
          {o.source === "staff" && " · lançado pela equipe"}
        </p>
        <hr />
        <ul>
          {items.map((i) => (
            <li key={i.id} style={{ marginBottom: 6 }}>
              <strong style={{ fontSize: 14 }}>
                {i.quantity}x {i.product_name_snapshot}
              </strong>
              {(i.order_item_options ?? []).map((op, n) => (
                <div key={n}>
                  {"  "}- {op.item_name_snapshot}
                </div>
              ))}
              {i.notes && <div style={{ fontWeight: 700 }}>  ** {i.notes}</div>}
            </li>
          ))}
        </ul>
        {o.notes && (
          <>
            <hr />
            <p style={{ fontWeight: 700 }}>OBS: {o.notes}</p>
          </>
        )}
        <hr />
        <p className="center muted">PedeAe</p>
      </article>
      <AutoPrint />
    </>
  );
}
