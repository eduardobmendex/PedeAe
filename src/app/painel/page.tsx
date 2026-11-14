import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Header } from "@/components/header";
import { Card, Skeleton } from "@/components/ui";
import { isPlatformAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabels, type MemberRole } from "@/lib/validation";
import { PlatformHome } from "./platform-home";

export const metadata: Metadata = { title: "Meus estabelecimentos" };

// Tudo aqui depende da sessão: fica atrás de <Suspense> para a navegação não bloquear.
export default function PainelPage() {
  return (
    <Suspense
      fallback={
        <main aria-busy="true" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </main>
      }
    >
      <PainelContent />
    </Suspense>
  );
}

async function PainelContent() {
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
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <section>
          <h1 className="mb-4 text-2xl font-semibold">Meus estabelecimentos</h1>
          {orgs.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">
                Você ainda não tem acesso a nenhum estabelecimento. Peça ao administrador do seu estabelecimento para
                liberar o seu acesso.
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
      </main>
    </>
  );
}
