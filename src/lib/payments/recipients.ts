import "server-only";
import { PagarmeError, pagarmeRequest, simulatorEnabled } from "./pagarme";
import type { RecipientForm } from "./recipient-form";
import { splitPhone } from "./types";

// Recebedores (split) e KYC do Pagar.me, API v5:
//   POST /recipients                       cria o recebedor (status "registration")
//   GET  /recipients/{id}                  status + kyc_details { status, status_reason }
//   POST /recipients/{id}/kyc_link         link/QR da prova de vida (vale ~20 min; só com kyc "partially_denied")
// Webhook recipient.updated avisa as mudanças de status.

export type RecipientInfo = {
  id: string;
  name: string | null;
  status: string | null;
  type: "individual" | "corporation" | null;
  kycStatus: string | null;
  kycReason: string | null;
};

export type KycLink = { url: string; qrBase64: string | null; expiresAt: string | null };

export interface RecipientsApi {
  readonly name: "pagarme" | "simulator";
  create(form: RecipientForm, organizationId: string): Promise<RecipientInfo>;
  get(id: string): Promise<RecipientInfo>;
  kycLink(id: string): Promise<KycLink>;
}

const NOT_INFORMED = "Não informado";
/** "AAAA-MM-DD" → "DD/MM/AAAA" (formato do exemplo da documentação para birthdate). */
const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const phones = (value: string) => {
  const p = splitPhone(value)!;
  return [{ ddd: p.areaCode, number: p.number, type: "mobile" }];
};

export function buildRecipientBody(f: RecipientForm, organizationId: string) {
  const address = {
    street: f.street,
    complementary: f.complementary || NOT_INFORMED,
    street_number: f.street_number,
    neighborhood: f.neighborhood,
    city: f.city,
    state: f.state,
    zip_code: f.zip_code,
    reference_point: f.reference_point || NOT_INFORMED,
  };
  const site = f.site_url ? { site_url: f.site_url } : {};

  const register_information =
    f.kind === "individual"
      ? {
          type: "individual",
          name: f.name,
          email: f.email,
          document: f.document,
          ...site,
          ...(f.mother_name ? { mother_name: f.mother_name } : {}),
          birthdate: brDate(f.birthdate),
          monthly_income: f.monthly_income,
          professional_occupation: f.professional_occupation,
          address,
          phone_numbers: phones(f.phone),
        }
      : {
          type: "corporation",
          email: f.email,
          document: f.document,
          ...site,
          // Na documentação v5: company_name = "Nome fantasia" e trading_name = "Razão social".
          company_name: f.trading_name,
          trading_name: f.company_name,
          annual_revenue: f.annual_revenue,
          corporation_type: f.corporation_type,
          founding_date: f.founding_date,
          main_address: address,
          phone_numbers: phones(f.phone),
          managing_partners: [
            {
              type: "individual",
              name: f.partner_name,
              email: f.partner_email,
              document: f.partner_document,
              ...(f.partner_mother_name ? { mother_name: f.partner_mother_name } : {}),
              birthdate: brDate(f.partner_birthdate),
              monthly_income: f.partner_monthly_income,
              professional_occupation: f.partner_occupation,
              self_declared_legal_representative: true,
              address,
              phone_numbers: phones(f.partner_phone),
            },
          ],
        };

  return {
    code: organizationId,
    register_information,
    default_bank_account: {
      holder_name: f.holder_name,
      holder_type: f.kind === "individual" ? "individual" : "company",
      holder_document: f.document,
      bank: f.bank,
      branch_number: f.branch_number,
      ...(f.branch_check_digit ? { branch_check_digit: f.branch_check_digit } : {}),
      account_number: f.account_number,
      account_check_digit: f.account_check_digit,
      type: f.account_type,
    },
    transfer_settings: {
      transfer_enabled: true,
      transfer_interval: f.transfer_interval,
      transfer_day: f.transfer_interval === "Daily" ? 0 : f.transfer_day,
    },
    metadata: { organization_id: organizationId, origem: "pedeae" },
  };
}

type RawRecipient = {
  id: string;
  name?: string;
  status?: string;
  type?: string;
  kyc_details?: { status?: string; status_reason?: string } | null;
};

export function parseRecipient(raw: RawRecipient): RecipientInfo {
  return {
    id: raw.id,
    name: raw.name ?? null,
    status: raw.status ?? null,
    type: raw.type === "individual" ? "individual" : raw.type ? "corporation" : null, // resposta usa "company"
    kycStatus: raw.kyc_details?.status ?? null,
    kycReason: raw.kyc_details?.status_reason ?? null,
  };
}

/** A referência e o guia do Pagar.me usam nomes diferentes: aceita os dois. */
export function parseKycLink(raw: { url?: string; base64_qrcode?: string; base64?: string; expires_at?: string; expiration_date?: string }): KycLink {
  if (!raw?.url) throw new PagarmeError("Resposta sem link de KYC", 502, raw);
  const qr = raw.base64_qrcode ?? raw.base64 ?? null;
  return {
    url: raw.url,
    qrBase64: qr ? (qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`) : null,
    expiresAt: raw.expires_at ?? raw.expiration_date ?? null,
  };
}

class PagarmeRecipients implements RecipientsApi {
  readonly name = "pagarme" as const;
  constructor(private readonly key: string) {}
  async create(form: RecipientForm, organizationId: string) {
    const body = buildRecipientBody(form, organizationId);
    return parseRecipient(await pagarmeRequest<RawRecipient>(this.key, "/recipients", { method: "POST", body: JSON.stringify(body) }));
  }
  async get(id: string) {
    return parseRecipient(await pagarmeRequest<RawRecipient>(this.key, `/recipients/${encodeURIComponent(id)}`));
  }
  async kycLink(id: string) {
    return parseKycLink(await pagarmeRequest(this.key, `/recipients/${encodeURIComponent(id)}/kyc_link`, { method: "POST", body: "{}" }));
  }
}

/**
 * Simulador: o recebedor nasce pedindo documentos (kyc partially_denied); gerar o link
 * de KYC simula a pessoa concluindo a prova de vida (aprovado na próxima consulta).
 * IDs desconhecidos (ex.: servidor reiniciado) voltam como aprovados.
 */
const simulated = new Map<string, RecipientInfo>();
class SimulatorRecipients implements RecipientsApi {
  readonly name = "simulator" as const;
  async create(form: RecipientForm) {
    const id = `re_sim${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const info: RecipientInfo = {
      id,
      name: form.kind === "individual" ? form.name : form.company_name,
      status: "affiliation",
      type: form.kind,
      kycStatus: "partially_denied",
      kycReason: "additional_documents_required",
    };
    simulated.set(id, info);
    return { ...info };
  }
  async get(id: string) {
    const info = simulated.get(id);
    if (info) return { ...info };
    if (!id.startsWith("re_sim")) throw new PagarmeError("Recebedor não encontrado (simulador)", 404, { message: "Recipient not found" });
    return { id, name: null, status: "active", type: null, kycStatus: "approved", kycReason: "ok" };
  }
  async kycLink(id: string) {
    const info = simulated.get(id);
    if (info && info.kycStatus !== "partially_denied")
      throw new PagarmeError("Sem KYC pendente (simulador)", 404, { message: `${id} doesn´t have any kyc with partially_denied status.` });
    if (info) Object.assign(info, { status: "active", kycStatus: "approved", kycReason: "ok" });
    return { url: `https://simulador.pedeae.local/kyc/${id}`, qrBase64: null, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() };
  }
}

/** API de recebedores configurada, ou null (sem chave do Pagar.me e sem simulador). */
export function recipientsApi(): RecipientsApi | null {
  const key = process.env.PAGARME_SECRET_KEY;
  if (key) return new PagarmeRecipients(key);
  if (simulatorEnabled()) return new SimulatorRecipients();
  return null;
}

/** Ambiente da chave: teste (sk_test_) ou produção (sk_). */
export function pagarmeEnvironment(): "test" | "live" | "simulator" | null {
  const key = process.env.PAGARME_SECRET_KEY;
  if (key) return key.startsWith("sk_test_") ? "test" : "live";
  return simulatorEnabled() ? "simulator" : null;
}

/** Erro do link de KYC quando o Pagar.me não está pedindo documentos. */
export const isNoPendingKyc = (e: unknown) =>
  e instanceof PagarmeError && e.status === 404 && /partially_denied/i.test(JSON.stringify(e.details ?? ""));
