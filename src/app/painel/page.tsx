import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Card } from "@/components/ui";
import { isPlatformAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabels, type MemberRole } from "@/lib/validation";
import { CreateOrganizationForm } from "./create-organization-form";
import { PlatformHome } from "./platform-home";

export const metadata: Metadata = { title: "Meus estabelecimentos" };

export default async function PainelPage() {
  const user = await requireUser();
  if (await isPlatformAdmin()) {
    return (
      <>
        <Header />
        <PlatformHome />
      </>
    );
  }
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations (id, name, slug)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at");

  const orgs = (memberships ?? []).flatMap((m) =>
    m.organizations ? [{ ...(m.organizations as unknown as { id: string; name: string; slug: string }), role: m.role as MemberRole }] : [],
  );

  return (
    <>
      <Header />
      <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 md:grid-cols-[1fr_22rem]">
        <section>
          <h1 className="mb-4 text-2xl font-semibold">Meus estabelecimentos</h1>
          {orgs.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">
                Você ainda não participa de nenhum estabelecimento. Crie o seu ao lado ou peça um convite ao
                administrador.
              </p>
            </Card>
          ) : (
            <ul className="grid gap-3">
              {orgs.map((org) => (
                <li key={org.id}>
                  <Link href={`/painel/${org.slug}`}>
                    <Card className="flex items-center justify-between transition-colors hover:border-border-strong">
                      <div>
                        <p className="font-medium">{org.name}</p>
                        <p className="text-sm text-muted">/m/{org.slug}</p>
                      </div>
                      <span className="text-sm text-muted">{roleLabels[org.role]}</span>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <Card>
            <h2 className="mb-4 font-semibold">Novo estabelecimento</h2>
            <CreateOrganizationForm />
          </Card>
        </aside>
      </main>
    </>
  );
}
