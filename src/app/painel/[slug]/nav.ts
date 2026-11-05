import { can, type Permission } from "@/lib/permissions";
import type { MemberRole } from "@/lib/validation";

export type NavItem = { href: string; label: string; soon?: boolean };

type NavDef = {
  path: string;
  label: string;
  /** Mostra se o membro tiver qualquer uma das permissões (vazio = todos). */
  anyOf: Permission[];
  soon?: boolean;
};

const NAV: NavDef[] = [
  { path: "", label: "Início", anyOf: [] },
  { path: "/pedidos", label: "Pedidos", anyOf: ["view_orders"] },
  { path: "/cozinha", label: "Cozinha", anyOf: ["view_orders"], soon: true },
  { path: "/mesas", label: "Mesas", anyOf: ["manage_tables"] },
  { path: "/cardapio", label: "Cardápio", anyOf: ["manage_menu"] },
  { path: "/qrcodes", label: "QR Codes", anyOf: ["manage_tables"] },
  { path: "/cupons", label: "Cupons", anyOf: ["manage_coupons"], soon: true },
  { path: "/relatorios", label: "Relatórios", anyOf: ["view_reports"], soon: true },
  { path: "/equipe", label: "Equipe", anyOf: [] },
  { path: "/configuracoes", label: "Configurações", anyOf: ["manage_brand", "manage_theme"] },
];

export function navFor(slug: string, member: { role: MemberRole; permissions: Record<string, boolean> }): NavItem[] {
  return NAV.filter(
    (item) =>
      // Equipe: somente admin e supervisor visualizam.
      (item.path !== "/equipe" || member.role !== "staff") &&
      (item.anyOf.length === 0 || item.anyOf.some((p) => can(member, p))),
  ).map((item) => ({ href: `/painel/${slug}${item.path}`, label: item.label, soon: item.soon }));
}
