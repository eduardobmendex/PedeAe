import type { Metadata } from "next";
import { Badge, Button, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteTable, rotateTableQr, setTableActive } from "./actions";
import { CreateTablesForm, RenameTableForm } from "./table-forms";

export const metadata: Metadata = { title: "Mesas" };

export default async function TablesPage({ params }: PageProps<"/painel/[slug]/mesas">) {
  const { slug } = await params;
  const { organization } = await requirePermission(slug, "manage_tables");
  const supabase = await createClient();

  const { data: tables } = await supabase
    .from("tables")
    .select("id, name, active, table_qr_codes (created_at, revoked_at)")
    .eq("organization_id", organization.id)
    .order("sort_order")
    .order("name");

  return (
    <>
      <PageHeader
        title="Mesas"
        description="Cada mesa tem um QR Code próprio. Ocupação e contas aparecem aqui quando os pedidos estiverem ativos."
        actions={
          (tables ?? []).length > 0 && (
            <ButtonLink href={`/painel/${slug}/qrcodes`} variant="secondary">
              Imprimir QR Codes
            </ButtonLink>
          )
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_18rem]">
        {(tables ?? []).length === 0 ? (
          <EmptyState title="Nenhuma mesa cadastrada">Crie as mesas ao lado. Você pode gerar várias de uma vez.</EmptyState>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {(tables ?? []).map((t) => {
                const activeQr = t.table_qr_codes?.find((q) => !q.revoked_at);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 p-3">
                    <RenameTableForm slug={slug} id={t.id} name={t.name} />
                    {t.active ? <Badge tone="success">ativa</Badge> : <Badge>desativada</Badge>}
                    <span className="hidden text-xs text-muted sm:inline">
                      QR desde {activeQr ? new Date(activeQr.created_at).toLocaleDateString("pt-BR") : "—"}
                    </span>
                    <div className="ml-auto flex flex-wrap gap-1">
                      <form action={setTableActive.bind(null, slug, t.id, !t.active)}>
                        <Button type="submit" variant="ghost" className="h-8 px-3">
                          {t.active ? "Desativar" : "Ativar"}
                        </Button>
                      </form>
                      <form action={rotateTableQr.bind(null, slug, t.id)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          className="h-8 px-3"
                          title="Invalida o QR Code impresso e gera um novo"
                        >
                          Trocar QR
                        </Button>
                      </form>
                      <form action={deleteTable.bind(null, slug, t.id)}>
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
          <h2 className="mb-4 font-semibold">Criar mesas</h2>
          <CreateTablesForm slug={slug} />
        </Card>
      </div>
    </>
  );
}
