import { signOut } from "@/app/login/actions";
import { getCurrentUser, getOrgContext } from "@/lib/auth";
import { roleLabels } from "@/lib/validation";
import { navFor } from "./nav";
import { Sidebar } from "./sidebar";

export default async function OrgLayout({ children, params }: LayoutProps<"/painel/[slug]">) {
  const { slug } = await params;
  const { organization, membership, isPlatformAdmin } = await getOrgContext(slug);
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar
        orgName={organization.name}
        roleLabel={isPlatformAdmin ? "Admin da plataforma" : roleLabels[membership.role]}
        email={user?.email ?? ""}
        items={navFor(slug, membership)}
        signOutAction={signOut}
      />
      <main className="w-full min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8 print:p-0">
        <div className="mx-auto max-w-5xl">
          {(isPlatformAdmin || organization.status !== "active") && (
            <p className="mb-6 rounded-lg bg-info-soft px-4 py-2.5 text-sm text-info print:hidden">
              {isPlatformAdmin && "Você está gerenciando este estabelecimento como administrador da plataforma. "}
              {organization.status !== "active" &&
                "Estabelecimento suspenso: o cardápio público está fora do ar e os clientes não conseguem fazer pedidos."}
            </p>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
