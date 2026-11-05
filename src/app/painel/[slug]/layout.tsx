import { Suspense, type ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { BrandScope } from "@/components/brand-scope";
import { Skeleton } from "@/components/ui";
import { getCurrentUser, getOrgContext } from "@/lib/auth";
import { roleLabels } from "@/lib/validation";
import { navFor } from "./nav";
import { Sidebar } from "./sidebar";

type Params = LayoutProps<"/painel/[slug]">["params"];

const FRAME = "flex min-h-dvh flex-col md:flex-row";

// A moldura depende da sessão e da identidade do estabelecimento, então fica atrás de
// <Suspense>: a navegação não bloqueia e cada página tem o próprio loading.tsx.
export default function OrgLayout({ children, params }: LayoutProps<"/painel/[slug]">) {
  return (
    <Suspense fallback={<FrameSkeleton />}>
      <OrgFrame params={params}>{children}</OrgFrame>
    </Suspense>
  );
}

async function OrgFrame({ params, children }: { params: Params; children: ReactNode }) {
  const { slug } = await params;
  const { organization, membership, isPlatformAdmin, branding } = await getOrgContext(slug);
  const user = await getCurrentUser();

  return (
    <BrandScope branding={branding} className={`${FRAME} bg-bg text-text print:bg-white`}>
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
    </BrandScope>
  );
}

function FrameSkeleton() {
  return (
    <div aria-busy="true" className={FRAME}>
      <aside className="flex flex-col gap-3 border-b border-border bg-nav p-4 print:hidden md:h-dvh md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <Skeleton className="h-10 w-40" />
        <div className="hidden flex-col gap-2 pt-4 md:flex">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </aside>
      <div className="flex w-full min-w-0 flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
