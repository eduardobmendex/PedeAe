import "server-only";
import { onlyDigits, splitPhone, type BillingAddress, type Payer } from "./types";

// Cliente mínimo da API v5 do Pagar.me (https://docs.pagar.me).
// Autenticação: HTTP Basic com a chave secreta como usuário e senha vazia.
// O tipo da chave (sk_test_ / sk_) define se vai para o simulador do Pagar.me ou produção.
//
// Sem PAGARME_SECRET_KEY e com PAYMENTS_SIMULATOR=1, usa o simulador local (desenvolvimento e testes).

export type SplitTarget = { recipientId: string; platformRecipientId?: string; platformFeePercent: number };

export type ProviderOrder = {
  id: string;
  status: string; // pending | paid | canceled | failed
  paidAmountCents: number;
  chargeStatus?: string;
  pix?: { qrCode: string; qrCodeUrl: string; expiresAt: string };
  failureReason?: string;
};

export type CreateOrderInput = {
  intentId: string;
  organizationId: string;
  description: string;
  amountCents: number;
  payer: Payer;
  split: SplitTarget;
} & ({ method: "pix"; pixExpiresInSeconds: number } | { method: "credit_card"; cardToken: string; billing: BillingAddress });

export interface PaymentProvider {
  readonly name: "pagarme" | "simulator";
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  getOrder(id: string): Promise<ProviderOrder>;
}

const API_URL = process.env.PAGARME_API_URL ?? "https://api.pagar.me/core/v5";

export class PagarmeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Regras de split: o estabelecimento recebe o valor, é responsável por chargeback, taxas e sobras.
 * Com comissão da PedeAe, a plataforma recebe o percentual dela (inteiro) e nada mais.
 */
export function buildSplit({ recipientId, platformRecipientId, platformFeePercent }: SplitTarget) {
  const fee = platformRecipientId ? Math.max(0, Math.min(20, Math.round(platformFeePercent))) : 0;
  const rules: Record<string, unknown>[] = [
    {
      amount: 100 - fee,
      type: "percentage",
      recipient_id: recipientId,
      options: { liable: true, charge_processing_fee: true, charge_remainder_fee: true },
    },
  ];
  if (fee > 0) {
    rules.push({
      amount: fee,
      type: "percentage",
      recipient_id: platformRecipientId,
      options: { liable: false, charge_processing_fee: false, charge_remainder_fee: false },
    });
  }
  return rules;
}

/** Corpo do POST /orders (exportado para teste). */
export function buildOrderBody(input: CreateOrderInput) {
  const phone = splitPhone(input.payer.phone);
  const customer: Record<string, unknown> = {
    name: input.payer.name.trim(),
    email: input.payer.email.trim().toLowerCase(),
    document: onlyDigits(input.payer.document),
    document_type: "CPF",
    type: "individual",
    ...(phone && { phones: { mobile_phone: { country_code: phone.countryCode, area_code: phone.areaCode, number: phone.number } } }),
  };

  const payment: Record<string, unknown> =
    input.method === "pix"
      ? { payment_method: "pix", pix: { expires_in: input.pixExpiresInSeconds } }
      : {
          payment_method: "credit_card",
          credit_card: {
            installments: 1,
            statement_descriptor: "PEDEAE",
            card_token: input.cardToken,
            card: {
              billing_address: {
                line_1: `${input.billing.number}, ${input.billing.street}, ${input.billing.neighborhood}`,
                zip_code: onlyDigits(input.billing.zipCode),
                city: input.billing.city,
                state: input.billing.state.toUpperCase(),
                country: "BR",
              },
            },
          },
        };
  payment.split = buildSplit(input.split);

  return {
    code: input.intentId,
    items: [{ amount: input.amountCents, description: input.description.slice(0, 256), quantity: 1, code: "pedeae" }],
    customer,
    payments: [payment],
    metadata: { intent_id: input.intentId, organization_id: input.organizationId },
  };
}

type RawOrder = {
  id: string;
  status: string;
  amount?: number;
  charges?: {
    status: string;
    paid_amount?: number;
    last_transaction?: { qr_code?: string; qr_code_url?: string; expires_at?: string; status?: string; acquirer_message?: string; gateway_response?: { errors?: { message: string }[] } };
  }[];
};

/** Normaliza a resposta de pedido do Pagar.me (exportado para teste). */
export function parseOrder(raw: RawOrder): ProviderOrder {
  const charge = raw.charges?.[0];
  const tx = charge?.last_transaction;
  // Erro do gateway (ex.: "action_forbidden | | Sem ambiente configurado…") é configuração da conta, não do cliente.
  const gatewayFailure = (msg?: string) => {
    if (!msg) return undefined;
    console.error("[pagarme] gateway recusou:", msg);
    return "Esta forma de pagamento está indisponível agora. Tente a outra opção ou avise a equipe.";
  };
  const paid = raw.status === "paid" || charge?.status === "paid";
  return {
    id: raw.id,
    status: paid ? "paid" : raw.status,
    chargeStatus: charge?.status,
    paidAmountCents: paid ? (charge?.paid_amount ?? raw.amount ?? 0) : 0,
    pix: tx?.qr_code ? { qrCode: tx.qr_code, qrCodeUrl: tx.qr_code_url ?? "", expiresAt: tx.expires_at ?? "" } : undefined,
    failureReason:
      raw.status === "failed" || charge?.status === "failed"
        ? (tx?.acquirer_message ?? gatewayFailure(tx?.gateway_response?.errors?.[0]?.message) ?? "Pagamento recusado")
        : undefined,
  };
}

class PagarmeProvider implements PaymentProvider {
  readonly name = "pagarme" as const;
  constructor(private readonly secretKey: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new PagarmeError(`Pagar.me ${res.status}`, res.status, body);
    return body as T;
  }

  async createOrder(input: CreateOrderInput) {
    return parseOrder(await this.request<RawOrder>("/orders", { method: "POST", body: JSON.stringify(buildOrderBody(input)) }));
  }

  async getOrder(id: string) {
    return parseOrder(await this.request<RawOrder>(`/orders/${encodeURIComponent(id)}`));
  }
}

/**
 * Simulador local: mesmo contrato, sem dinheiro de verdade. Pix gera um código fictício;
 * cartão aprova na hora (token "tok_recusar" recusa). O pagamento do Pix é marcado pela
 * página de pagamento (botão "Simular pagamento"), via markSimulatedPaid.
 */
const simulated = new Map<string, ProviderOrder & { amount: number }>();
class SimulatorProvider implements PaymentProvider {
  readonly name = "simulator" as const;
  async createOrder(input: CreateOrderInput) {
    const id = `or_sim_${input.intentId.replaceAll("-", "").slice(0, 16)}_${Date.now().toString(36)}`;
    const approved = input.method === "credit_card" && input.cardToken !== "tok_recusar";
    const order: ProviderOrder & { amount: number } = {
      id,
      amount: input.amountCents,
      status: input.method === "pix" ? "pending" : approved ? "paid" : "failed",
      paidAmountCents: approved ? input.amountCents : 0,
      pix:
        input.method === "pix"
          ? {
              qrCode: `00020126SIMULADOR-PEDEAE-${input.intentId}5204000053039865802BR6304ABCD`,
              qrCodeUrl: "",
              expiresAt: new Date(Date.now() + input.pixExpiresInSeconds * 1000).toISOString(),
            }
          : undefined,
      failureReason: input.method === "credit_card" && !approved ? "Cartão recusado (simulador)" : undefined,
    };
    simulated.set(id, order);
    return order;
  }
  async getOrder(id: string) {
    const o = simulated.get(id);
    if (!o) throw new PagarmeError("Pedido do simulador não encontrado", 404);
    return o;
  }
}

export function markSimulatedPaid(id: string) {
  const o = simulated.get(id);
  if (o) Object.assign(o, { status: "paid", paidAmountCents: o.amount });
}

export const simulatorEnabled = () => !process.env.PAGARME_SECRET_KEY && process.env.PAYMENTS_SIMULATOR === "1";

/** Provedor configurado, ou null se o pagamento online não está disponível neste servidor. */
export function paymentProvider(): PaymentProvider | null {
  const key = process.env.PAGARME_SECRET_KEY;
  if (key) return new PagarmeProvider(key);
  if (simulatorEnabled()) return new SimulatorProvider();
  return null;
}

/** IDs de recebedor do Pagar.me: "re_..." (contas atuais) ou "rp_..." (contas antigas). */
export const RECIPIENT_ID_RE = /^(re|rp)_[A-Za-z0-9]+$/;

/** Recebedor da comissão da PedeAe. Um ID que não é de recebedor (ex.: "acc_...") é ignorado, para não quebrar o split. */
export const platformRecipientId = () => {
  const id = process.env.PAGARME_PLATFORM_RECIPIENT_ID?.trim();
  if (!id) return undefined;
  if (RECIPIENT_ID_RE.test(id)) return id;
  console.error("[pagarme] PAGARME_PLATFORM_RECIPIENT_ID não é um recebedor (re_... ou rp_...); comissão desativada.");
  return undefined;
};
