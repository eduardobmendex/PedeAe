"use client";

import { useLayoutEffect } from "react";
import { themeIds, type ThemeId } from "@/lib/themes";

// A identidade visual é de cada estabelecimento e vem do banco. Fora dele (login,
// lista de estabelecimentos) vale a identidade padrão. O navegador guarda só uma cópia,
// para a página já nascer com o tema certo ao recarregar.

const SCOPE_PREFIX = "pedeae-org-theme:";
const SCOPE_PATH = /^\/(?:painel|m|q|pedido)\/([^/]+)/;

/** Roda antes da primeira pintura: define o tema para evitar flash. */
export const themeInitScript = `try{var m=location.pathname.match(${SCOPE_PATH}),t=m&&localStorage.getItem(${JSON.stringify(SCOPE_PREFIX)}+m[1]);if(${JSON.stringify(themeIds)}.indexOf(t)>=0)document.documentElement.dataset.theme=t}catch(e){}`;

function rememberScopeTheme(theme: ThemeId) {
  const segment = location.pathname.match(SCOPE_PATH)?.[1];
  try {
    if (segment) localStorage.setItem(SCOPE_PREFIX + segment, theme);
  } catch {}
}

/** Mantém <html> (fundo da página, barras de rolagem) na identidade do estabelecimento. */
export function ThemeScope({ theme }: { theme: ThemeId }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    rememberScopeTheme(theme);
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);
  return null;
}

/** Aplica a identidade em toda a tela na hora, sem esperar o servidor. */
export function applyScopeTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  rememberScopeTheme(theme);
  document.querySelectorAll<HTMLElement>("[data-theme-scope]").forEach((el) => {
    el.dataset.theme = theme;
    // Escolher uma identidade desliga as cores próprias.
    for (const prop of ["--brand", "--brand-contrast", "--brand-text", "--accent", "--accent-contrast"]) {
      el.style.removeProperty(prop);
    }
  });
}
