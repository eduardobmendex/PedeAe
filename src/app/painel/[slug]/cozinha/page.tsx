import type { Metadata } from "next";
import Link from "next/link";
import { OrdersLive } from "@/components/orders-live";
import { SoldOutPanel, type StockProduct } from "@/components/sold-out-panel";
import { requirePermission } from "@/lib/auth";
import type { OrderStatus } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";
import { KitchenBoard, type KitchenOrder } from "./kitchen-board";

export const metadata: Metadata = { title: "Cozinha" };

// Fila de preparo: só pedidos já aceitos. "Aguardando confirmação" é decidido na tela de Pedidos.
const KITCHEN_STATUSES: OrderStatus[] = ["received", "preparing", "ready"];

export default async function KitchenPage({ params }: PageProps<"/painel/[slug]/cozinha">) {
  const { slug } = await params;
  const { organization } = await requirePermission(slug, "view_orders");
  const supabase = await createClient();

  const [{ data }, { count: awaiting }, { data: stock }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `id, order_number, status, customer_name, notes, created_at, updated_at,
         tables (name),
         order_items (id, product_name_snapshot, quantity, notes, sort_order, order_item_options (item_name_snapshot))`,
      )
      .eq("organization_id", organization.id)
      .in("status", KITCHEN_STATUSES)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("status", "pending_confirmation"),
    // Produtos à venda (categorias publicadas), para marcar esgotado.
    supabase
      .from("products")
      .select("id, name, sold_out, categories!inner (name, active, sort_order)")
      .eq("organization_id", organization.id)
      .eq("available", true)
      .eq("categories.active", true)
      .order("name"),
  ]);
  type StockRow = { id: string; name: string; sold_out: boolean; categories: { name: string; sort_order: number } };
  const products: StockProduct[] = ((stock ?? []) as unknown as StockRow[])
    .sort((a, b) => a.categories.sort_order - b.categories.sort_order || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, category: p.categories.name, sold_out: p.sold_out }));

  const orders: KitchenOrder[] = (data ?? []).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    status: o.status as OrderStatus,
    customer_name: o.customer_name,
    notes: o.notes,
    created_at: o.created_at,
    updated_at: o.updated_at,
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

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cozinha</h1>
          <p className="text-sm text-muted">Do mais antigo para o mais novo. Toque no botão para avançar o pedido.</p>
        </div>
        <OrdersLive orgId={organization.id} alertOn="kitchen" />
      </div>

      {!!awaiting && (
        <Link
          href={`/painel/${slug}/pedidos`}
          className="rounded-lg bg-warning-soft px-4 py-2.5 text-sm font-medium text-warning hover:underline"
        >
          {awaiting} pedido(s) aguardando confirmação na tela de Pedidos →
        </Link>
      )}

      <KitchenBoard slug={slug} orders={orders} />

      {products.length > 0 && <SoldOutPanel slug={slug} products={products} />}
    </div>
  );
}
