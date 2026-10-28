import type { Metadata } from "next";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { requireOrgRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabels, statusLabels, type MemberRole, type MemberStatus } from "@/lib/validation";
import { revokeInvitation } from "./actions";
import { PlatformCreateMemberForm } from "../../platform-forms";
import { InviteForm, MembershipForm, PermissionsForm } from "./team-forms";

export const metadata: Metadata = { title: "Equipe" };

export default async function TeamPage({ params }: PageProps<"/painel/[slug]/equipe">) {
  const { slug } = await params;
  const { organization, membership: me, isPlatformAdmin } = await requireOrgRole(slug, ["admin", "supervisor"]);
  const isAdmin = me.role === "admin";
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("memberships")
    .select("id, user_id, role, status, permissions, created_at")
    .eq("organization_id", organization.id)
    .order("created_at");

  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", userIds);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const { data: invitations } = isAdmin
    ? await supabase
        .from("invitations")
        .select("id, email, role, expires_at")
        .eq("organization_id", organization.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <PageHeader
        title="Equipe"
        description={isAdmin ? "Convide pessoas, defina papéis e ajuste permissões." : "Pessoas com acesso ao painel."}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="flex flex-col gap-6">
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {(members ?? []).map((m) => {
                const profile = profileById.get(m.user_id);
                const isMe = m.id === me.id;
                const role = m.role as MemberRole;
                const status = m.status as MemberStatus;
                return (
                  <li key={m.id} className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          {profile?.name || profile?.email || "Usuário"}
                          {isMe && <Badge>você</Badge>}
                          {status === "disabled" && <Badge tone="danger">desativado</Badge>}
                        </p>
                        <p className="truncate text-sm text-muted">{profile?.email}</p>
                      </div>
                      {isAdmin && !isMe ? (
                        <MembershipForm slug={slug} membershipId={m.id} role={role} status={status} />
                      ) : (
                        <span className="text-sm text-muted">
                          {roleLabels[role]} · {statusLabels[status]}
                        </span>
                      )}
                    </div>
                    {isAdmin && !isMe && status === "active" && (
                      <PermissionsForm
                        slug={slug}
                        membershipId={m.id}
                        role={role}
                        current={(m.permissions ?? {}) as Record<string, boolean>}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {isAdmin && (invitations ?? []).length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold">Convites pendentes</h2>
              <Card className="p-0">
                <ul className="divide-y divide-border">
                  {(invitations ?? []).map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{inv.email}</p>
                        <p className="text-sm text-muted">
                          {roleLabels[inv.role as MemberRole]} · expira em{" "}
                          {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <form action={revokeInvitation.bind(null, slug, inv.id)}>
                        <Button type="submit" variant="danger">
                          Revogar
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </section>

        {isAdmin && (
          <aside className="flex flex-col gap-6">
            {isPlatformAdmin && (
              <Card>
                <h2 className="mb-1 font-semibold">Cadastrar com senha</h2>
                <p className="mb-4 text-sm text-muted">
                  Cria a conta já confirmada e vincula a este estabelecimento. Exclusivo do administrador da plataforma.
                </p>
                <PlatformCreateMemberForm slug={slug} />
              </Card>
            )}
            <Card>
              <h2 className="mb-1 font-semibold">Convidar pessoa</h2>
              <p className="mb-4 text-sm text-muted">
                Gere um link e envie para a pessoa. Ela entra (ou cria conta) com o mesmo e-mail.
              </p>
              <InviteForm slug={slug} />
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}
