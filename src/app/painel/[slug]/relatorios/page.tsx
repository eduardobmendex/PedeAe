import type { Metadata } from "next";
import Link from "next/link";
import { ColumnChart, type Column } from "@/components/column-chart";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { businessToday, daysBetween, periodPresets, resolvePeriod, type PeriodPreset } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Relatórios" };

type Report = {
  totals: { orders: number; revenue_cents: number; avg_ticket_cents: number; items_sold: number };
  cancelled: { orders: number; value_cents: number };
  by_day: { day: string; orders: number; revenue_cents: number }[];
  by_hour: { hour: number; orders: number; revenue_cents: number }[];
  top_products: { name: string; quantity: number; revenue_cents: number }[];
  by_table: { name: string; orders: number; revenue_cents: number; avg_ticket_cents: number }[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

export default async function ReportsPage({ params, searchParams }: PageProps<"/painel/[slug]/relatorios">) {
  const { slug } = await params;
  // A sessão vem primeiro: "hoje" (new Date) só pode ser calculado durante a requisição.
  const { organization } = await requirePermission(slug, "view_reports");
  const today = businessToday();
  const period = resolvePeriod(await searchParams, today);
  const supabase = await createClient();

  const [{ data, error }, { data: payData }] = await Promise.all([
    supabase.rpc("report_sales", { p_org_id: organization.id, p_from: period.from, p_to: period.to }),
    supabase.rpc("report_payments", { p_org_id: organization.id, p_from: period.from, p_to: period.to }),
  ]);
  const report = data as Report | null;
  const payments = payData as PaymentsReport | null;
  const base = `/painel/${slug}/relatorios`;
  const range = `de=${period.from}&ate=${period.to}`;

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`${period.label}. Contam os pedidos aceitos; cancelados e recusados aparecem à parte.`}
        actions={
          <>
            <a
              href={`${base}/csv?tipo=pedidos&${range}`}
              className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium hover:bg-hover"
            >
              Exportar pedidos (CSV)
            </a>
            <a
              href={`${base}/csv?tipo=produtos&${range}`}
              className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium hover:bg-hover"
            >
              Exportar produtos (CSV)
            </a>
          </>
        }
      />

      {/* Filtros numa linha, acima de tudo. */}
      <div className="mb-6 flex flex-wrap items-end gap-2">
        <nav aria-label="Período" className="flex flex-wrap gap-2">
          {(Object.keys(periodPresets) as PeriodPreset[]).map((key) => (
            <Link
              key={key}
              href={`${base}?periodo=${key}`}
              aria-current={period.key === key ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                period.key === key ? "bg-brand text-brand-contrast" : "bg-surface-2 text-muted hover:text-text"
              }`}
            >
              {periodPresets[key]}
            </Link>
          ))}
        </nav>
        <form action={base} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="periodo" value="personalizado" />
          <label className="flex flex-col text-xs text-muted">
            De
            <input type="date" name="de" defaultValue={period.from} max={today} className="h-9 rounded-lg border border-input-border bg-input px-2 text-sm text-text" />
          </label>
          <label className="flex flex-col text-xs text-muted">
            Até
            <input type="date" name="ate" defaultValue={period.to} max={today} className="h-9 rounded-lg border border-input-border bg-input px-2 text-sm text-text" />
          </label>
          <button
            type="submit"
            className={`h-9 rounded-full px-3.5 text-sm font-medium ${
              period.key === "personalizado" ? "bg-brand text-brand-contrast" : "bg-surface-2 text-muted hover:text-text"
            }`}
          >
            Aplicar
          </button>
        </form>
      </div>

      {error || !report ? (
        <EmptyState title="Não foi possível gerar o relatório">Tente novamente em instantes.</EmptyState>
      ) : (
        <>
          <ReportBody report={report} days={daysBetween(period.from, period.to) + 1} />
          {payments && <PaymentsSection report={payments} csvHref={`${base}/csv?tipo=recebimentos&${range}`} />}
        </>
      )}
    </>
  );
}

function ReportBody({ report, days }: { report: Report; days: number }) {
  const { totals, cancelled } = report;
  const byDay: Column[] = report.by_day.map((d) => ({
    label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}`,
    title: weekday.format(new Date(`${d.day}T00:00:00Z`)),
    value: d.revenue_cents,
    detail: plural(d.orders, "pedido", "pedidos"),
  }));
  const byHour: Column[] = report.by_hour.map((h) => ({
    label: `${h.hour}h`,
    title: `${String(h.hour).padStart(2, "0")}h–${String(h.hour).padStart(2, "0")}h59`,
    value: h.revenue_cents,
    detail: plural(h.orders, "pedido", "pedidos"),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Faturamento" value={formatBRL(totals.revenue_cents)} />
        <Stat label="Pedidos" value={String(totals.orders)} />
        <Stat label="Ticket médio" value={formatBRL(totals.avg_ticket_cents)} />
        <Stat
          label="Itens vendidos"
          value={String(totals.items_sold)}
          note={cancelled.orders ? `${plural(cancelled.orders, "cancelado", "cancelados")} · ${formatBRL(cancelled.value_cents)}` : undefined}
        />
      </div>

      {totals.orders === 0 ? (
        <EmptyState title="Nenhuma venda neste período">Escolha outro período ou aguarde os primeiros pedidos.</EmptyState>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            {days > 1 && (
              <Card>
                <h2 className="font-semibold">Faturamento por dia</h2>
                <p className="mb-4 text-sm text-muted">Passe o mouse sobre as colunas para ver os valores.</p>
                <ColumnChart data={byDay} caption="Faturamento por dia" labelEvery={Math.ceil(days / 10)} />
              </Card>
            )}
            <Card className={days > 1 ? "" : "xl:col-span-2"}>
              <h2 className="font-semibold">Faturamento por hora</h2>
              <p className="mb-4 text-sm text-muted">Soma do período, pelo horário em que o pedido foi feito.</p>
              <ColumnChart data={byHour} caption="Faturamento por hora do dia" labelEvery={3} />
            </Card>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card className="p-0">
              <h2 className="p-4 pb-2 font-semibold">Produtos mais vendidos</h2>
              <DataTable
                head={["Produto", "Qtd.", "Faturamento"]}
                rows={report.top_products.map((p) => [p.name, String(p.quantity), formatBRL(p.revenue_cents)])}
              />
            </Card>
            <Card className="p-0">
              <h2 className="p-4 pb-2 font-semibold">Desempenho por mesa</h2>
              <DataTable
                head={["Mesa", "Pedidos", "Faturamento", "Ticket médio"]}
                rows={report.by_table.map((t) => [t.name, String(t.orders), formatBRL(t.revenue_cents), formatBRL(t.avg_ticket_cents)])}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

type PaymentsReport = {
  total_cents: number;
  by_method: { method: string; count: number; amount_cents: number; online_cents: number | null }[];
  by_person: { name: string; count: number; amount_cents: number }[];
  service_fee_cents: number;
  tabs_closed: number;
};

/** Fechamento de caixa: quanto entrou em cada forma de pagamento, quem recebeu e a taxa de serviço. */
function PaymentsSection({ report, csvHref }: { report: PaymentsReport; csvHref: string }) {
  const total = report.total_cents || 1;
  return (
    <section className="mt-8 flex flex-col gap-4" aria-labelledby="recebimentos">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="recebimentos" className="text-lg font-semibold">
            Recebimentos
          </h2>
          <p className="text-sm text-muted">O que entrou nas contas das mesas no período, para conferir o caixa e as maquininhas.</p>
        </div>
        <a href={csvHref} className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium hover:bg-hover">
          Exportar recebimentos (CSV)
        </a>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total recebido" value={formatBRL(report.total_cents)} />
        <Stat label="Taxa de serviço" value={formatBRL(report.service_fee_cents)} note="Das contas fechadas no período" />
        <Stat label="Contas fechadas" value={String(report.tabs_closed)} />
      </div>
      {report.total_cents === 0 ? (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted">Nenhum recebimento registrado neste período.</p>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <h3 className="font-semibold">Por forma de pagamento</h3>
            <ul className="flex flex-col gap-3">
              {report.by_method.map((m) => (
                <li key={m.method}>
                  <div className="mb-1 flex justify-between gap-3 text-sm">
                    <span className="font-medium">
                      {methodLabel(m.method)} <span className="font-normal text-muted">· {m.count}x</span>
                    </span>
                    <span className="tabular-nums">{formatBRL(m.amount_cents)}</span>
                  </div>
                  {/* Barra de proporção: uma série, cor do tema com contraste garantido. */}
                  <div className="h-2 rounded-full bg-surface-2" aria-hidden>
                    <div className="h-2 rounded-full" style={{ width: `${(m.amount_cents / total) * 100}%`, background: "var(--brand-text)" }} />
                  </div>
                  {m.online_cents ? <p className="mt-1 text-xs text-muted">{formatBRL(m.online_cents)} pagos online pelo cardápio</p> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-0">
            <h3 className="p-4 pb-2 font-semibold">Por quem recebeu</h3>
            <DataTable head={["Pessoa", "Pagamentos", "Valor"]} rows={report.by_person.map((p) => [p.name, String(p.count), formatBRL(p.amount_cents)])} />
          </Card>
        </div>
      )}
    </section>
  );
}

const METHOD_LABELS: Record<string, string> = { dinheiro: "Dinheiro", credito: "Cartão de crédito", debito: "Cartão de débito", pix: "Pix" };
const methodLabel = (m: string) => METHOD_LABELS[m] ?? m;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </Card>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-4 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2 ${j > 0 ? "text-right tabular-nums" : "font-medium"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
