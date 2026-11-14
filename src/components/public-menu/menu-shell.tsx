import type { ReactNode } from "react";
import type { PublicMenu } from "@/lib/menu";
import { BrandScope } from "@/components/brand-scope";
import { brandingFrom } from "@/lib/theme";
import { MenuFrame } from "./menu-frame";
import { ServiceWorkerRegister } from "./sw-register";

/** Aplica identidade, cores, fonte, cantos e papel de parede do estabelecimento. */
export function MenuShell({ menu, children }: { menu: PublicMenu; children: ReactNode }) {
  const branding = brandingFrom(menu.branding);
  return (
    <BrandScope branding={branding} className="flex min-h-dvh flex-col bg-bg text-text">
      <ServiceWorkerRegister />
      <MenuFrame wallpaper={branding.wallpaper} />
      {children}
    </BrandScope>
  );
}

export function MenuSkeleton() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col" aria-busy="true" aria-label="Carregando cardápio">
      <div className="h-36 animate-pulse bg-surface-2" />
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

export function MenuNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-bg px-6 text-center text-text">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="max-w-sm text-muted">{children}</div>
    </main>
  );
}
