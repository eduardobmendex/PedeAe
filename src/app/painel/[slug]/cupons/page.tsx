import type { Metadata } from "next";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatBRL } from "@/lib/money";
import { businessToday } from "@/lib/report-period";
import { createClient } from "@/lib/supabase/server";
import { deleteCoupon, setCouponActive } from "./actions";
import { CouponForm } from "./coupon-form";

export const metadata: Metadata = { title: "Cupons" };

type Coupon = {
  id: string;
  code: string;
  description: string | null;
  kind: "percent" | "fixed";
  value: number;
  min_order_cents: number;
  max_uses: number | null;
  valid_from: string | null;
  valid_until: string | null;
  active: boolean;
};

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export default async function CouponsPage({ params }: PageProps<"/painel/[slug]/cupons">) {
  const { slug } = await params;
  const { organization } = await requirePermission(slug, "manage_coupons");
  const today = businessToday();
  const supabase = await createClient();

  const [{ data: coupons }, { data: used }] = await Promise.all([
    supabase.from("coupons").select("*").eq("organization_id", organization.id).order("created_at", { ascending: false }),
    // Usos e desconto concedido: pedidos não cancelados com cupom.
    supabase
      .from("orders")
      .select("coupon_id, discount_cents")
      .eq("organization_id", organization.id)
      .not("coupon_id", "is", null)
      .not("status", "in", "(cancelled,rejected)"),
  ]);
  const stats = new Map<string, { uses: number; discount: number }>();
  for (const o of used ?? []) {
    const s = stats.get(o.coupon_id as string) ?? { uses: 0, discount: 0 };
    s.uses += 1;
    s.discount += o.discount_cents;
    stats.set(o.coupon_id as string, s);
  }

  const status = (c: Coupon, uses: number): { label: string; tone: "success" | "neutral" | "warning" | "danger" } => {
    if (!c.active) return { label: "Desativado", tone: "neutral" };
    if (c.valid_until && today > c.valid_until) return { label: "Vencido", tone: "danger" };
    if (c.valid_from && today < c.valid_from) return { label: `A partir de ${br(c.valid_from)}`, tone: "warning" };
    if (c.max_uses !== null && uses >= c.max_uses) return { label: "Esgotado", tone: "danger" };
    return { label: "Ativo", tone: "success" };
  };

  return (
    <>
      <PageHeader
        title="Cupons"
        description="Descontos que o cliente aplica no carrinho do cardápio. Pedidos cancelados devolvem o uso ao cupom."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        {(coupons ?? []).length === 0 ? (
          <EmptyState title="Nenhum cupom ainda">Crie o primeiro ao lado, por exemplo BEMVINDO com 10% de desconto.</EmptyState>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {((coupons ?? []) as Coupon[]).map((c) => {
                const s = stats.get(c.id) ?? { uses: 0, discount: 0 };
                const st = status(c, s.uses);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-bold">{c.code}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </p>
                      <p className="text-sm">
                        {c.kind === "percent" ? `${c.value}% de desconto` : `${formatBRL(c.value)} de desconto`}
                        {c.min_order_cents > 0 && ` · pedido mínimo ${formatBRL(c.min_order_cents)}`}
                        {c.description && <span className="text-muted"> · {c.description}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {s.uses} uso(s){c.max_uses !== null && ` de ${c.max_uses}`} · {formatBRL(s.discount)} em descontos
                        {(c.valid_from || c.valid_until) &&
                          ` · válido ${c.valid_from ? `de ${br(c.valid_from)} ` : ""}${c.valid_until ? `até ${br(c.valid_until)}` : "sem fim"}`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <form action={setCouponActive.bind(null, slug, c.id, !c.active)}>
                        <Button type="submit" variant="ghost" className="h-8 px-3">
                          {c.active ? "Desativar" : "Ativar"}
                        </Button>
                      </form>
                      <form action={deleteCoupon.bind(null, slug, c.id)}>
                        <Button type="submit" variant="ghost" className="h-8 px-3 text-danger">
                          Excluir
                        </Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <Card>
          <h2 className="mb-4 font-semibold">Novo cupom</h2>
          <CouponForm slug={slug} />
        </Card>
      </div>
    </>
  );
}
