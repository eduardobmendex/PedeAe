import { afterEach, describe, expect, it, vi } from "vitest";
import { recipientFormSchema } from "@/lib/payments/recipient-form";
import { canShareKyc, kycInfo, nextStep } from "@/lib/payments/recipient-status";
import { buildRecipientBody, isNoPendingKyc, parseKycLink, parseRecipient, recipientsApi } from "@/lib/payments/recipients";
import { isValidCnpj } from "@/lib/payments/types";

const address = {
  zip_code: "40140-110",
  street: "Rua A",
  street_number: "10",
  complementary: "",
  neighborhood: "Barra",
  city: "Salvador",
  state: "ba",
  reference_point: "",
};
const bank = {
  holder_name: "Lagostao LTDA",
  bank: "341",
  branch_number: "1234",
  branch_check_digit: "",
  account_number: "56789",
  account_check_digit: "0",
  account_type: "checking",
  transfer_interval: "Daily",
  transfer_day: "0",
};
const pj = {
  kind: "corporation",
  company_name: "Lagostão Comércio de Alimentos LTDA",
  trading_name: "Lagostão",
  document: "11.222.333/0001-81",
  annual_revenue: "500.000,00",
  corporation_type: "LTDA",
  founding_date: "2015-03-20",
  partner_name: "Ana Souza",
  partner_document: "529.982.247-25",
  partner_email: "ana@exemplo.com",
  partner_birthdate: "1985-07-01",
  partner_monthly_income: "8.000,00",
  partner_occupation: "Empresária",
  partner_mother_name: "",
  partner_phone: "(71) 99876-5432",
  email: "contato@lagostao.com",
  phone: "(71) 3333-4444",
  site_url: "",
  ...address,
  ...bank,
};
const pf = {
  kind: "individual",
  name: "Ana Souza",
  document: "529.982.247-25",
  mother_name: "Maria Souza",
  birthdate: "1985-07-01",
  monthly_income: "8.000,00",
  professional_occupation: "Empresária",
  email: "ana@exemplo.com",
  phone: "(71) 99876-5432",
  site_url: "https://instagram.com/lagostao",
  ...address,
  ...bank,
  holder_name: "Ana Souza",
};

describe("formulário Iniciar KYC", () => {
  it("valida CNPJ, CPF, datas, valores e conta", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(recipientFormSchema.safeParse(pj).success).toBe(true);
    expect(recipientFormSchema.safeParse(pf).success).toBe(true);
    const bad = (patch: object) => recipientFormSchema.safeParse({ ...pj, ...patch }).error?.issues[0].message;
    expect(bad({ document: "11.222.333/0001-80" })).toMatch(/CNPJ/);
    expect(bad({ partner_document: "111.111.111-11" })).toMatch(/CPF do sócio/);
    expect(bad({ founding_date: "2999-01-01" })).toMatch(/abertura/);
    expect(bad({ annual_revenue: "abc" })).toMatch(/Faturamento/);
    expect(bad({ bank: "34" })).toMatch(/Banco/);
    expect(bad({ zip_code: "4014" })).toMatch(/CEP/);
    expect(bad({ site_url: "lagostao.com" })).toMatch(/Site/);
  });
});

describe("corpo enviado ao Pagar.me", () => {
  it("pessoa jurídica: empresa, sócio representante, conta no CNPJ e repasse", () => {
    const form = recipientFormSchema.parse(pj);
    const body = buildRecipientBody(form, "org-1");
    expect(body.code).toBe("org-1");
    const ri = body.register_information as Record<string, unknown>;
    expect(ri).toMatchObject({
      type: "corporation",
      document: "11222333000181",
      company_name: "Lagostão", // na documentação v5: company_name = nome fantasia
      trading_name: "Lagostão Comércio de Alimentos LTDA",
      annual_revenue: 50_000_000,
      corporation_type: "LTDA",
      founding_date: "2015-03-20",
      phone_numbers: [{ ddd: "71", number: "33334444", type: "mobile" }],
    });
    expect(ri.main_address).toEqual({
      street: "Rua A",
      complementary: "Não informado",
      street_number: "10",
      neighborhood: "Barra",
      city: "Salvador",
      state: "BA",
      zip_code: "40140110",
      reference_point: "Não informado",
    });
    expect((ri.managing_partners as object[])[0]).toMatchObject({
      name: "Ana Souza",
      document: "52998224725",
      birthdate: "01/07/1985",
      monthly_income: 800_000,
      self_declared_legal_representative: true,
    });
    expect(ri).not.toHaveProperty("site_url");
    expect(body.default_bank_account).toEqual({
      holder_name: "Lagostao LTDA",
      holder_type: "company",
      holder_document: "11222333000181",
      bank: "341",
      branch_number: "1234",
      account_number: "56789",
      account_check_digit: "0",
      type: "checking",
    });
    expect(body.transfer_settings).toEqual({ transfer_enabled: true, transfer_interval: "Daily", transfer_day: 0 });
  });

  it("pessoa física: dados pessoais e conta no CPF", () => {
    const body = buildRecipientBody(recipientFormSchema.parse(pf), "org-2");
    expect(body.register_information).toMatchObject({
      type: "individual",
      name: "Ana Souza",
      document: "52998224725",
      mother_name: "Maria Souza",
      birthdate: "01/07/1985",
      site_url: "https://instagram.com/lagostao",
      address: { zip_code: "40140110", state: "BA" },
    });
    expect(body.default_bank_account).toMatchObject({ holder_type: "individual", holder_document: "52998224725" });
  });
});

describe("respostas do Pagar.me", () => {
  it("recebedor com kyc_details; tipo company vira corporation", () => {
    expect(
      parseRecipient({ id: "re_1", name: "Lagostão", status: "affiliation", type: "company", kyc_details: { status: "partially_denied", status_reason: "additional_documents_required" } }),
    ).toEqual({ id: "re_1", name: "Lagostão", status: "affiliation", type: "corporation", kycStatus: "partially_denied", kycReason: "additional_documents_required" });
    expect(parseRecipient({ id: "re_2", status: "active" })).toMatchObject({ kycStatus: null, type: null });
  });

  it("link de KYC: aceita os dois formatos da documentação", () => {
    expect(parseKycLink({ url: "https://kyc/x", base64_qrcode: "AAA", expires_at: "2026-11-19T10:00:00Z" })).toEqual({
      url: "https://kyc/x",
      qrBase64: "data:image/png;base64,AAA",
      expiresAt: "2026-11-19T10:00:00Z",
    });
    expect(parseKycLink({ url: "https://kyc/y", base64: "data:image/png;base64,BBB", expiration_date: "2026-11-19T11:00:00Z" })).toMatchObject({
      qrBase64: "data:image/png;base64,BBB",
      expiresAt: "2026-11-19T11:00:00Z",
    });
    expect(() => parseKycLink({})).toThrow();
  });
});

describe("status em português", () => {
  it("KYC, próximo passo e quando dá para compartilhar o link", () => {
    expect(kycInfo("partially_denied", "additional_documents_required")?.label).toBe("Aguardando documentos");
    expect(kycInfo("pending", "waiting_manual_risk_analysis")?.label).toBe("Análise manual");
    expect(kycInfo(null, null)).toBeNull();
    expect(nextStep(null, null, null)).toMatch(/Iniciar o KYC/);
    expect(nextStep("re_1", "affiliation", "partially_denied")).toMatch(/link de KYC/);
    expect(nextStep("re_1", "refused", "denied")).toMatch(/suporte/);
    expect(nextStep("re_1", "active", "approved")).toMatch(/liberados/);
    expect(canShareKyc("re_1", "partially_denied", "affiliation")).toBe(true);
    expect(canShareKyc("re_1", "approved", "active")).toBe(false);
    expect(canShareKyc(null, null, null)).toBe(false);
  });
});

describe("simulador de recebedores", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("nasce pedindo documentos; o link de KYC aprova; segundo link dá 'sem KYC pendente'", async () => {
    vi.stubEnv("PAGARME_SECRET_KEY", "");
    vi.stubEnv("PAYMENTS_SIMULATOR", "1");
    const api = recipientsApi()!;
    expect(api.name).toBe("simulator");
    const created = await api.create(recipientFormSchema.parse(pj), "org-1");
    expect(created).toMatchObject({ status: "affiliation", kycStatus: "partially_denied", type: "corporation" });
    const link = await api.kycLink(created.id);
    expect(link.url).toContain(created.id);
    expect(await api.get(created.id)).toMatchObject({ status: "active", kycStatus: "approved" });
    const err = await api.kycLink(created.id).catch((e) => e);
    expect(isNoPendingKyc(err)).toBe(true);
    await expect(api.get("re_naoexiste")).rejects.toThrow();
  });
});
