// Todo o painel depende da sessão (cookies), então a renderização bloqueia no servidor.
// Skeletons com <Suspense> entram junto com o design system (Etapa 2).
export const instant = false;

export default function PainelLayout({ children }: LayoutProps<"/painel">) {
  return children;
}
