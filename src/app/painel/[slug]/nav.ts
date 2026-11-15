import { can, type Permission } from "@/lib/permissions";
import type { MemberRole } from "@/lib/validation";

export type NavItem = { href: string; label: string; soon?: boolean };

type NavDef = {
  path: string;
  label: string;
  /** Mostra se o membro tiver qualquer uma das permissões (vazio = todos). */
  anyOf: Permission[];
  soon?: boolean;
  /** Só para estes cargos (ausente = qualquer cargo). */
  roles?: MemberRole[];
  /** Só para o Admin Geral da plataforma. */
  platformOnly?: boolean;
};

const NAV: NavDef[] = [
  { path: "", label: "Início", anyOf: [] },
  { path: "/pedidos", label: "Pedidos", anyOf: ["view_orders"] },
  { path: "/cozinha", label: "Cozinha", anyOf: ["view_orders"] },
  { path: "/contas", label: "Contas", anyOf: ["receive_payments", "close_tabs"] },
  { path: "/mesas", label: "Mesas", anyOf: ["manage_tables"] },
  { path: "/cardapio", label: "Cardápio", anyOf: ["manage_menu"] },
  { path: "/qrcodes", label: "QR Codes", anyOf: ["manage_tables"] },
  { path: "/cupons", label: "Cupons", anyOf: ["manage_coupons"] },
  { path: "/relatorios", label: "Relatórios", anyOf: ["view_reports"] },
  { path: "/equipe", label: "Equipe", anyOf: [], roles: ["admin", "supervisor"] },
  { path: "/configuracoes", label: "Configurações", anyOf: ["manage_brand", "manage_theme"] },
  { path: "/auditoria", label: "Auditoria", anyOf: [], roles: ["admin"] },
  { path: "/assinatura", label: "Assinatura", anyOf: [], platformOnly: true },
];

export function navFor(
  slug: string,
  member: { role: MemberRole; permissions: Record<string, boolean> },
  { platformAdmin = false }: { platformAdmin?: boolean } = {},
): NavItem[] {
  return NAV.filter(
    (item) =>
      (!item.platformOnly || platformAdmin) &&
      (!item.roles || item.roles.includes(member.role)) &&
      (item.anyOf.length === 0 || item.anyOf.some((p) => can(member, p))),
  ).map((item) => ({ href: `/painel/${slug}${item.path}`, label: item.label, soon: item.soon }));
}
