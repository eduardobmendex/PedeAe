import type { MemberRole } from "./validation";

// Espelho de private.permission_rule (migration 20261028170000). A interface usa
// para esconder ações; quem decide de verdade é o banco (private.can).
// O teste tests/db/permissions.test.ts garante que os dois não divergem.

export const permissions = [
  "manage_brand",
  "manage_menu",
  "manage_tables",
  "view_orders",
  "create_manual_order",
  "apply_coupons",
  "manage_coupons",
  "cancel_orders",
  "receive_payments",
  "close_tabs",
  "view_reports",
  "manage_team",
] as const;
export type Permission = (typeof permissions)[number];

/** yes = sempre | no = nunca | on/off = configurável (padrão permitido/negado) */
export type Rule = "yes" | "no" | "on" | "off";

export const permissionLabels: Record<Permission, string> = {
  manage_brand: "Editar dados e identidade visual",
  manage_menu: "Gerenciar produtos e preços",
  manage_tables: "Gerenciar mesas e QR Codes",
  view_orders: "Visualizar e atualizar pedidos",
  create_manual_order: "Lançar pedido manualmente",
  apply_coupons: "Aplicar cupons",
  manage_coupons: "Criar cupons",
  cancel_orders: "Cancelar pedidos",
  receive_payments: "Receber pagamentos",
  close_tabs: "Fechar contas e liberar mesas",
  view_reports: "Consultar relatórios de vendas",
  manage_team: "Convidar e gerenciar usuários",
};

export const permissionMatrix: Record<Exclude<MemberRole, "admin">, Record<Permission, Rule>> = {
  supervisor: {
    manage_brand: "no",
    manage_menu: "on",
    manage_tables: "on",
    view_orders: "yes",
    create_manual_order: "yes",
    apply_coupons: "yes",
    manage_coupons: "on",
    cancel_orders: "on",
    receive_payments: "on",
    close_tabs: "yes",
    view_reports: "on",
    manage_team: "no",
  },
  staff: {
    manage_brand: "no",
    manage_menu: "no",
    manage_tables: "no",
    view_orders: "yes",
    create_manual_order: "yes",
    apply_coupons: "off",
    manage_coupons: "no",
    cancel_orders: "off",
    receive_payments: "off",
    close_tabs: "off",
    view_reports: "no",
    manage_team: "no",
  },
};

export function ruleFor(role: MemberRole, permission: Permission): Rule {
  return role === "admin" ? "yes" : permissionMatrix[role][permission];
}

export function isConfigurable(role: MemberRole, permission: Permission) {
  const rule = ruleFor(role, permission);
  return rule === "on" || rule === "off";
}

export function can(
  member: { role: MemberRole; permissions?: Record<string, unknown> | null },
  permission: Permission,
): boolean {
  const rule = ruleFor(member.role, permission);
  if (rule === "yes") return true;
  if (rule === "no") return false;
  const override = member.permissions?.[permission];
  return typeof override === "boolean" ? override : rule === "on";
}
