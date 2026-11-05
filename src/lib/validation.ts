import { z } from "zod";

export const memberRoles = ["admin", "supervisor", "staff"] as const;
export const memberStatuses = ["active", "disabled"] as const;
export type MemberRole = (typeof memberRoles)[number];
export type MemberStatus = (typeof memberStatuses)[number];

export const roleLabels: Record<MemberRole, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  staff: "Funcionário",
};

export const statusLabels: Record<MemberStatus, string> = {
  active: "Ativo",
  disabled: "Desativado",
};

const email = z.string().trim().toLowerCase().email("E-mail inválido");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Informe a senha"),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  email,
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, "Use 3 a 48 letras minúsculas, números ou hífens"),
});

export const invitationSchema = z.object({
  organizationId: z.string().uuid(),
  email,
  role: z.enum(memberRoles),
});

export const updateMembershipSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(memberRoles),
  status: z.enum(memberStatuses),
});

/** Gera um slug a partir do nome ("Pastel do Zé" -> "pastel-do-ze"). */
export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Aceita apenas caminhos internos como destino de redirecionamento. */
export function safeNextPath(next: unknown, fallback = "/painel") {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Cor inválida (use #RRGGBB)");

export const brandingSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(120),
  custom_colors: z.literal("on").optional().transform((v) => v === "on"),
  brand_color: hexColor,
  accent_color: hexColor,
  font: z.enum(["geist", "lora", "nunito"]),
  corners: z.enum(["square", "rounded", "pill"]),
  logo_path: z.string().max(300).transform((v) => v || null),
  cover_path: z.string().max(300).transform((v) => v || null),
});
