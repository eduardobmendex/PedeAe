import Link from "next/link";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PlatformCreateOrganizationForm } from "./platform-forms";
import { setOrganizationStatus } from "./platform-actions";

const statusInfo = {
  active: { label: "Ativo", tone: "success" },
  suspended: { label: "Suspenso", tone: "warning" },
  cancelled: { label: "Cancelado", tone: "danger" },
} as const;
type OrgStatus = keyof typeof statusInfo;

/** Visão do dono do SaaS: todos os estabelecimentos da plataforma. */
export async function PlatformHome() {
  const supabase = await createClient();
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, slug, status, created_at, memberships(count)")
    .order("created_at", { ascending: false });

  const list = (orgs ?? []).map((o) => ({
    ...o,
    status: o.status as OrgStatus,
    members: (o.memberships as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
  const active = list.filter((o) => o.status === "active").length;

  return (
    <main className="mx-auto grid w-full max-w-6xl items-start gap-6 px-4 py-8 lg:grid-cols-[1fr_22rem]">
      <section>
        <PageHeader
          title="Administração da plataforma"
          description={`${list.length} estabelecimento(s) · ${active} ativo(s). Você tem acesso de administrador em todos.`}
        />
        {list.length === 0 ? (
          <EmptyState title="Nenhum estabelecimento ainda">Cadastre o primeiro cliente ao lado.</EmptyState>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {list.map((org) => (
                <li key={org.id} className="flex flex-wrap items-center gap-3 p-4">
                  <Link href={`/painel/${org.slug}`} className="min-w-0 flex-1 hover:underline">
                    <p className="flex items-center gap-2 font-medium">
                      {org.name}
                      <Badge tone={statusInfo[org.status].tone}>{statusInfo[org.status].label}</Badge>
                    </p>
                    <p className="text-sm text-muted">
                      /m/{org.slug} · {org.members} usuário(s) · desde {new Date(org.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </Link>
                  <div className="flex gap-1">
                    {org.status === "active" ? (
                      <form action={setOrganizationStatus.bind(null, org.id, "suspended")}>
                        <Button type="submit" variant="ghost" className="h-8 px-3 text-warning">
                          Suspender
                        </Button>
                      </form>
                    ) : (
                      <form action={setOrganizationStatus.bind(null, org.id, "active")}>
                        <Button type="submit" variant="ghost" className="h-8 px-3 text-success">
                          Reativar
                        </Button>
                      </form>
                    )}
                    <Link href={`/painel/${org.slug}`} className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium hover:bg-surface-2">
                      Gerenciar
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="mt-3 text-xs text-muted">
          Estabelecimento suspenso some do cardápio público e para de receber pedidos dos clientes. A equipe continua
          acessando o painel.
        </p>
      </section>

      <aside>
        <Card>
          <h2 className="mb-1 font-semibold">Novo estabelecimento</h2>
          <p className="mb-4 text-sm text-muted">Depois de criar, cadastre o administrador do cliente na tela de Equipe.</p>
          <PlatformCreateOrganizationForm />
        </Card>
      </aside>
    </main>
  );
}
