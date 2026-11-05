import type { ReactNode } from "react";
import { ThemeScope } from "@/components/theme-scope";
import { brandStyle, type Branding } from "@/lib/theme";

/** Raiz de qualquer tela de um estabelecimento: aplica a identidade dele a tudo que estiver dentro. */
export function BrandScope({ branding, className, children }: { branding: Branding; className?: string; children: ReactNode }) {
  return (
    <div data-theme={branding.theme} data-theme-scope style={brandStyle(branding)} className={className}>
      <ThemeScope theme={branding.theme} />
      {children}
    </div>
  );
}
