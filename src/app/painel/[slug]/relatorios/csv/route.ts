import { requirePermission } from "@/lib/auth";
import { centsCell, toCsv } from "@/lib/csv";
import { orderStatusLabels, type OrderStatus } from "@/lib/orders";
import { BUSINESS_TIME_ZONE, resolvePeriod } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";

const SALE: OrderStatus[] = ["received", "preparing", "ready", "delivered"];
const MAX_ROWS = 10_000;
const PAGE = 1_000;

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: BUSINESS_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit" });

type Row = {
  order_number: number;
  status: OrderStatus;
  customer_name: string | null;
  total_cents: number;
  created_at: string;
  tables: { name: string } | null;
  order_items: { product_name_snapshot: string; quantity: number; line_total_cents: number }[];
};

/** Exporta pedidos ou produtos vendidos do período (mesmos filtros da tela de relatórios). */
export async function GET(request: Request, ctx: RouteContext<"/painel/[slug]/relatorios/csv">) {
  const { slug } = await ctx.params;
  const { organization } = await requirePermission(slug, "view_reports");
  const url = new URL(request.url);
  const tipoParam = url.searchParams.get("tipo");
  const tipo = tipoParam === "produtos" || tipoParam === "recebimentos" ? tipoParam : "pedidos";
  const period = resolvePeriod({ periodo: "personalizado", de: url.searchParams.get("de") ?? "", ate: url.searchParams.get("ate") ?? "" });

  // Limites do período no fuso do estabelecimento (-03:00, sem horário de verão).
  const start = new Date(`${period.from}T00:00:00-03:00`).toISOString();
  const end = new Date(new Date(`${period.to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString();

  const supabase = await createClient();

  if (tipo === "recebimentos") {
    const { data, error } = await supabase
      .from("tab_payments")
      .select("amount_cents, method, created_at, payment_intent_id, received_by, table_sessions (tables (name))")
      .eq("organization_id", organization.id)
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at")
      .limit(MAX_ROWS);
    if (error) return new Response("Não foi possível gerar o arquivo.", { status: 500 });
    type PayRow = {
      amount_cents: number;
      method: string;
      created_at: string;
      payment_intent_id: string | null;
      received_by: string | null;
      table_sessions: { tables: { name: string } | null } | null;
    };
    const list = (data ?? []) as unknown as PayRow[];
    const ids = [...new Set(list.map((p) => p.received_by).filter((v): v is string => !!v))];
    const { data: people } = ids.length ? await supabase.from("profiles").select("id, name, email").in("id", ids) : { data: [] };
    const nameOf = new Map((people ?? []).map((p) => [p.id, p.name || p.email || ""]));
    const labels: Record<string, string> = { dinheiro: "Dinheiro", credito: "Crédito", debito: "Débito", pix: "Pix" };
    const csv = toCsv(
      ["Data", "Hora", "Mesa", "Forma", "Online", "Recebido por", "Valor (R$)"],
      list.map((p) => [
        dateFmt.format(new Date(p.created_at)),
        timeFmt.format(new Date(p.created_at)),
        p.table_sessions?.tables?.name ?? "",
        labels[p.method] ?? p.method,
        p.payment_intent_id ? "sim" : "não",
        p.payment_intent_id ? "Pagamento online" : (nameOf.get(p.received_by ?? "") ?? ""),
        centsCell(p.amount_cents),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="recebimentos-${organization.slug}-${period.from}_${period.to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("orders")
      .select("order_number, status, customer_name, total_cents, created_at, tables (name), order_items (product_name_snapshot, quantity, line_total_cents)")
      .eq("organization_id", organization.id)
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) return new Response("Não foi possível gerar o arquivo.", { status: 500 });
    rows.push(...(data as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }

  let csv: string;
  if (tipo === "pedidos") {
    csv = toCsv(
      ["Pedido", "Data", "Hora", "Mesa", "Cliente", "Situação", "Itens", "Total (R$)"],
      rows.map((o) => [
        o.order_number,
        dateFmt.format(new Date(o.created_at)),
        timeFmt.format(new Date(o.created_at)),
        o.tables?.name ?? "Sem mesa",
        o.customer_name,
        orderStatusLabels[o.status],
        o.order_items.map((i) => `${i.quantity}x ${i.product_name_snapshot}`).join(", "),
        centsCell(o.total_cents),
      ]),
    );
  } else {
    const byProduct = new Map<string, { quantity: number; cents: number }>();
    for (const o of rows) {
      if (!SALE.includes(o.status)) continue;
      for (const i of o.order_items) {
        const p = byProduct.get(i.product_name_snapshot) ?? { quantity: 0, cents: 0 };
        p.quantity += i.quantity;
        p.cents += i.line_total_cents;
        byProduct.set(i.product_name_snapshot, p);
      }
    }
    csv = toCsv(
      ["Produto", "Quantidade", "Faturamento (R$)"],
      [...byProduct.entries()].sort((a, b) => b[1].quantity - a[1].quantity).map(([name, p]) => [name, p.quantity, centsCell(p.cents)]),
    );
  }

  const file = `${tipo}-${organization.slug}-${period.from}_${period.to}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
