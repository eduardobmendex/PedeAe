import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPublicMenu } from "@/lib/menu";
import { createClient } from "@/lib/supabase/server";
import { ManualOrderForm } from "./manual-order-form";

export const metadata: Metadata = { title: "Lançar pedido" };

export default async function NewOrderPage({ params, searchParams }: PageProps<"/painel/[slug]/pedidos/novo">) {
  const { slug } = await params;
  const { mesa } = await searchParams;
  const { organization, membership } = await requirePermission(slug, "create_manual_order");
  const supabase = await createClient();

  const [menu, { data: tables }] = await Promise.all([
    getPublicMenu(slug),
    supabase
      .from("tables")
      .select("id, name")
      .eq("organization_id", organization.id)
      .eq("active", true)
      .order("sort_order")
      .order("name"),
  ]);

  return (
    <>
      <PageHeader title="Lançar pedido" description="O pedido entra direto na fila como recebido." />
      {!menu || menu.categories.length === 0 ? (
        <EmptyState title="Nenhum produto disponível">Cadastre produtos no cardápio para lançar pedidos.</EmptyState>
      ) : (
        <ManualOrderForm
          slug={slug}
          menu={menu}
          tables={tables ?? []}
          canApplyCoupons={can(membership, "apply_coupons")}
          initialTableId={typeof mesa === "string" && (tables ?? []).some((t) => t.id === mesa) ? mesa : ""}
        />
      )}
    </>
  );
}
