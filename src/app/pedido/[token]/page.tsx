import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { MenuNotice, MenuSkeleton } from "@/components/public-menu/menu-shell";
import { getPublicMenu } from "@/lib/menu";
import { formatBRL } from "@/lib/money";
import { isFinal, orderStatusLabels, type OrderStatus } from "@/lib/orders";
import { createPublicClient } from "@/lib/supabase/public";
import { DEFAULT_BRANDING_ROW, brandingFrom } from "@/lib/theme";
import { AutoRefresh } from "@/components/auto-refresh";
import { BrandScope } from "@/components/brand-scope";

export const metadata: Metadata = { title: "Acompanhar pedido", robots: { index: false } };

type TrackedOrder = {
  order_number: number;
  status: OrderStatus;
  total_cents: number;
  customer_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  table_name: string | null;
  organization: { name: string; slug: string };
  items: {
    name: string;
    quantity: number;
    line_total_cents: number;
    notes: string | null;
    options: { option: string; item: string }[];
  }[];
};

const STEPS: { status: OrderStatus; label: string; hint: string }[] = [
  { status: "received", label: "Recebido", hint: "A equipe recebeu seu pedido." },
  { status: "preparing", label: "Em preparo", hint: "Seu pedido está sendo preparado." },
  { status: "ready", label: "Pronto", hint: "Já vai chegar até você." },
  { status: "delivered", label: "Entregue", hint: "Bom apetite!" },
];

export default function OrderTrackingPage({ params }: PageProps<"/pedido/[token]">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <OrderLoader params={params} />
    </Suspense>
  );
}

async function OrderLoader({ params }: { params: PageProps<"/pedido/[token]">["params"] }) {
  await connection(); // sempre dados ao vivo
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) return <NotFoundNotice />;

  const { data } = await createPublicClient().rpc("get_order_by_token", { p_token: token });
  const order = data as TrackedOrder | null;
  if (!order) return <NotFoundNotice />;

  const menu = await getPublicMenu(order.organization.slug);
  const branding = brandingFrom(menu?.branding ?? DEFAULT_BRANDING_ROW);
  const stoppedLabel =
    order.status === "awaiting_payment"
      ? "O pedido vai para o preparo assim que o pagamento for confirmado. Se fechou a página de pagamento, volte ao cardápio e faça o pedido de novo."
      : order.status === "pending_confirmation"
      ? "Aguardando a equipe confirmar seu pedido."
      : order.status === "rejected"
        ? "O estabelecimento não pôde aceitar este pedido. Fale com um atendente."
        : order.status === "cancelled"
          ? "Este pedido foi cancelado. Fale com um atendente se tiver dúvidas."
          : null;
  const currentIndex = STEPS.findIndex((s) => s.status === order.status);

  return (
    <BrandScope branding={branding} className="flex min-h-dvh flex-col bg-bg text-text">
      <AutoRefresh active={!isFinal(order.status)} />
      <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-8">
        <div className="text-center">
          <p className="text-sm text-muted">
            {order.organization.name}
            {order.table_name && ` · ${order.table_name}`}
          </p>
          <h1 className="mt-1 text-3xl font-bold">Pedido #{order.order_number}</h1>
          <p className="mt-1 text-sm text-muted">
            {new Date(order.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            {order.customer_name && ` · ${order.customer_name}`}
          </p>
        </div>

        <section
          aria-live="polite"
          style={{ borderRadius: "var(--radius)" }}
          className="border border-border bg-surface p-5 shadow-card"
        >
          {stoppedLabel ? (
            <div className="text-center">
              <p className="text-lg font-semibold">{orderStatusLabels[order.status]}</p>
              <p className="mt-1 text-sm text-muted">{stoppedLabel}</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-4">
              {STEPS.map((step, i) => {
                const done = i <= currentIndex;
                const current = i === currentIndex;
                return (
                  <li key={step.status} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        done ? "bg-brand text-brand-contrast" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <div>
                      <p className={current ? "font-semibold" : done ? "" : "text-muted"}>{step.label}</p>
                      {current && <p className="text-sm text-muted">{step.hint}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section style={{ borderRadius: "var(--radius)" }} className="border border-border bg-surface shadow-card">
          <h2 className="border-b border-border px-5 py-3 font-semibold">Itens</h2>
          <ul className="divide-y divide-border">
            {order.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {item.quantity}× {item.name}
                  </p>
                  {item.options.length > 0 && <p className="text-muted">{item.options.map((o) => o.item).join(", ")}</p>}
                  {item.notes && <p className="text-muted italic">“{item.notes}”</p>}
                </div>
                <span className="shrink-0">{formatBRL(item.line_total_cents)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-border px-5 py-3 font-semibold">
            <span>Total</span>
            <span>{formatBRL(order.total_cents)}</span>
          </div>
        </section>

        <p className="text-center text-xs text-muted">
          Esta página atualiza sozinha. Pagamento no local, ao final do atendimento.
        </p>
        <Link href={`/m/${order.organization.slug}`} className="text-center text-sm font-medium text-brand-text hover:underline">
          Ver cardápio
        </Link>
      </main>
    </BrandScope>
  );
}

function NotFoundNotice() {
  return <MenuNotice title="Pedido não encontrado">Confira o link ou peça ajuda a um atendente.</MenuNotice>;
}
