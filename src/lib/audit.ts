import { formatBRL } from "./money";
import { orderStatusLabels, type OrderStatus } from "./orders";
import { isRecipientStatus, kycInfo, recipientStatuses } from "./payments/recipient-status";
import { roleLabels, type MemberRole } from "./validation";

// Tradução dos registros de auditoria (gravados pelo banco) para frases legíveis.

export type AuditEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_user_id: string | null;
};

export const auditCategories = {
  cardapio: "Cardápio",
  mesas: "Mesas e QR Codes",
  equipe: "Equipe",
  visual: "Marca e visual",
  pedidos: "Pedidos",
  assinatura: "Assinatura",
} as const;
export type AuditCategory = keyof typeof auditCategories;

/** Prefixos de `action` de cada categoria (para filtrar no banco). */
export const categoryPrefixes: Record<AuditCategory, string[]> = {
  cardapio: ["products.", "categories.", "product_options.", "catalog.", "menu.", "coupons."],
  mesas: ["tables.", "table_qr."],
  equipe: ["membership.", "invitation."],
  visual: ["settings.", "organization."],
  pedidos: ["order.", "tab.", "payment."],
  assinatura: ["billing.", "payments."],
};

export function categoryOf(action: string): AuditCategory | null {
  for (const [cat, prefixes] of Object.entries(categoryPrefixes) as [AuditCategory, string[]][]) {
    if (prefixes.some((p) => action.startsWith(p))) return cat;
  }
  return null;
}

type Change = { from: unknown; to: unknown };
const isChange = (v: unknown): v is Change => typeof v === "object" && v !== null && "from" in v && "to" in v;

const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  description: "Descrição",
  price_cents: "Preço",
  available: "Disponível",
  active: "Ativo",
  featured: "Destaque",
  sold_out: "Esgotado",
  sold_out_until: "Esgotado até",
  code: "Código",
  value: "Valor",
  max_uses: "Limite de usos",
  valid_until: "Válido até",
  image_path: "Foto",
  category_id: "Categoria",
  sort_order: "Ordem",
  theme: "Identidade visual",
  brand_color: "Cor principal",
  accent_color: "Cor de destaque",
  logo_path: "Logo",
  cover_path: "Capa",
  wallpaper: "Papel de parede",
  font: "Fonte",
  corners: "Cantos",
  custom_colors: "Cores próprias",
  establishment_type: "Tipo do cardápio",
  require_order_confirmation: "Confirmar pedidos antes da cozinha",
  status: "Situação",
  role: "Cargo",
};
// Campos técnicos que não dizem nada a quem lê.
const HIDDEN = new Set(["id", "organization_id", "created_at", "updated_at", "source_catalog_key"]);

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (field.endsWith("_cents") && typeof value === "number") return formatBRL(value);
  if (field === "theme" && typeof value === "string") return value.toUpperCase();
  if (field === "role" && typeof value === "string" && value in roleLabels) return roleLabels[value as MemberRole];
  if (field.endsWith("_path")) return "nova imagem";
  if (field === "category_id") return "outra categoria";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** "Preço: R$ 18,00 → R$ 20,00" para cada campo alterado (inclui os campos internos de settings). */
export function describeChanges(metadata: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [field, change] of Object.entries(metadata)) {
    if (HIDDEN.has(field) || !isChange(change)) continue;
    if (field === "settings" && typeof change.from === "object" && typeof change.to === "object") {
      const from = (change.from ?? {}) as Record<string, unknown>;
      const to = (change.to ?? {}) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
        if (JSON.stringify(from[key]) !== JSON.stringify(to[key]) && FIELD_LABELS[key]) {
          lines.push(`${FIELD_LABELS[key]}: ${show(key, from[key])} → ${show(key, to[key])}`);
        }
      }
      continue;
    }
    const label = FIELD_LABELS[field] ?? field;
    if (field.endsWith("_path")) lines.push(`${label} alterada`);
    else if (field === "category_id") lines.push("Mudou de categoria");
    else lines.push(`${label}: ${show(field, change.from)} → ${show(field, change.to)}`);
  }
  return lines;
}

const ENTITY: Record<string, string> = { products: "o produto", categories: "a categoria", tables: "a mesa", coupons: "o cupom" };
const OP: Record<string, string> = { insert: "Criou", update: "Alterou", delete: "Excluiu" };

/** Título e detalhes de um registro. `name` é o nome atual da entidade, quando ainda existe. */
export function describeAudit(entry: AuditEntry, name?: string): { title: string; details: string[] } {
  const m = entry.metadata ?? {};
  const label = name ?? (typeof m.name === "string" ? m.name : typeof m.code === "string" ? m.code : undefined);
  const named = (s: string) => (label ? `${s} ${label}` : s);
  const [prefix, op] = entry.action.split(".");

  if (prefix in ENTITY && op in OP) {
    const details = op === "update" ? describeChanges(m) : [];
    if (op === "insert" && typeof m.price_cents === "number") details.push(`Preço: ${formatBRL(m.price_cents)}`);
    // "Criou a mesa Mesa 3" → "Criou a Mesa 3".
    const title = prefix === "tables" && label && /^mesa\s/i.test(label) ? `${OP[op]} a ${label}` : named(`${OP[op]} ${ENTITY[prefix]}`);
    return { title, details };
  }

  switch (entry.action) {
    case "settings.updated":
      return { title: "Alterou a marca e o visual", details: describeChanges(m) };
    case "organization.updated":
      return { title: "Alterou o estabelecimento", details: describeChanges(m) };
    case "organization.created":
      return { title: "Criou o estabelecimento", details: [] };
    case "catalog.imported":
      return { title: "Importou produtos do catálogo base", details: [`${m.imported ?? 0} importado(s), ${m.skipped ?? 0} já existente(s)`] };
    case "menu.type_switched":
      return { title: "Trocou o tipo do cardápio", details: [`Novo tipo: ${m.type}`, `${m.imported ?? 0} produto(s) novo(s)`] };
    case "product_options.replaced":
      return { title: named("Alterou os adicionais do produto"), details: [] };
    case "table_qr.rotated":
      return { title: named("Gerou um novo QR Code para a mesa"), details: ["O QR Code anterior deixou de funcionar"] };
    case "membership.created_by_platform":
      return { title: "Cadastrou um usuário na equipe", details: typeof m.role === "string" ? [`Cargo: ${show("role", m.role)}`] : [] };
    case "membership.updated":
      return { title: "Alterou o acesso de um membro da equipe", details: describeChanges(diffFromTo(m)) };
    case "membership.permissions_updated":
      return { title: "Alterou as permissões de um membro da equipe", details: [] };
    case "invitation.created":
      return { title: "Enviou um convite para a equipe", details: [] };
    case "invitation.accepted":
      return { title: "Aceitou um convite e entrou na equipe", details: [] };
    case "invitation.revoked":
      return { title: "Cancelou um convite", details: [] };
    case "order.manual_created":
      return { title: `Lançou o pedido #${m.order_number ?? ""}`.trim(), details: [] };
    case "order.cancelled":
    case "order.rejected": {
      const details = [`Situação anterior: ${orderStatusLabels[m.from as OrderStatus] ?? m.from}`];
      if (m.note) details.push(`Motivo: ${m.note}`);
      return { title: `${entry.action === "order.cancelled" ? "Cancelou" : "Recusou"} o pedido #${m.order_number ?? ""}`, details };
    }
    case "tab.payment_recorded":
      return { title: "Registrou um pagamento na conta da mesa", details: [`Valor: ${formatBRL(Number(m.amount_cents ?? 0))}`, `Forma: ${m.method}`] };
    case "tab.payment_deleted":
      return { title: "Excluiu um pagamento da conta da mesa", details: [`Valor: ${formatBRL(Number(m.amount_cents ?? 0))}`] };
    case "tab.closed":
      return {
        title: "Fechou a conta de uma mesa",
        details: [`Total: ${formatBRL(Number(m.total_cents ?? 0))}`, `Taxa de serviço: ${formatBRL(Number(m.service_fee_cents ?? 0))}`],
      };
    case "payment.online_confirmed":
      return {
        title: m.kind === "order" ? "Recebeu um pagamento online de pedido" : "Recebeu um pagamento online na conta da mesa",
        details: [`Valor: ${formatBRL(Number(m.amount_cents ?? 0))}`, `Forma: ${m.method === "credit_card" ? "cartão de crédito" : "Pix"}`],
      };
    case "payments.settings_updated":
      return {
        title: "Alterou o pagamento online",
        details: [
          `Ativo: ${m.enabled ? "sim" : "não"}`,
          `Comissão da PedeAe: ${m.platform_fee_percent ?? 0}%`,
          ...(m.recipient_id !== undefined ? [`Recebedor: ${m.recipient_id ?? "nenhum"}`] : []),
        ],
      };
    case "payments.recipient_status": {
      const label = (s: unknown) => (isRecipientStatus(s) ? recipientStatuses[s].label : s ? String(s) : "—");
      const kyc = kycInfo(m.kyc_status as string | null, m.kyc_status_reason as string | null);
      return {
        title: m.previous_status ? "Status do recebedor mudou no Pagar.me" : "Vinculou o recebedor do Pagar.me",
        details: [
          `Recebedor: ${m.recipient_id}`,
          m.previous_status ? `Status: ${label(m.previous_status)} → ${label(m.status)}` : `Status: ${label(m.status)}`,
          ...(kyc ? [`KYC: ${kyc.label}`] : []),
        ],
      };
    }
    case "payments.kyc_link_created":
      return { title: "Gerou o link de KYC do Pagar.me", details: [] };
    case "billing.updated":
      return { title: "Alterou o plano da assinatura", details: [`Plano: ${m.plan}`, `Mensalidade: ${formatBRL(Number(m.monthly_price_cents ?? 0))}`] };
    case "billing.payment_recorded":
      return { title: "Registrou um pagamento da assinatura", details: [`Referência: ${m.reference_month}`, `Valor: ${formatBRL(Number(m.amount_cents ?? 0))}`] };
    case "billing.payment_deleted":
      return { title: "Excluiu um pagamento da assinatura", details: [`Referência: ${m.reference_month}`] };
    default:
      return { title: entry.action, details: [] };
  }
}

/** membership.updated grava {from: {...}, to: {...}}; vira o formato campo → {from, to}. */
function diffFromTo(m: Record<string, unknown>): Record<string, unknown> {
  const from = (m.from ?? {}) as Record<string, unknown>;
  const to = (m.to ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    [...new Set([...Object.keys(from), ...Object.keys(to)])]
      .filter((k) => from[k] !== to[k])
      .map((k) => [k, { from: from[k], to: to[k] }]),
  );
}
