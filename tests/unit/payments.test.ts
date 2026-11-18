import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOrderBody, buildSplit, markSimulatedPaid, parseOrder, paymentProvider, type CreateOrderInput } from "@/lib/payments/pagarme";
import { isValidCpf, payerError, splitPhone } from "@/lib/payments/types";

const payer = { name: "Ana Souza", email: "Ana@Exemplo.com ", document: "529.982.247-25", phone: "(71) 99876-5432" };
const base = {
  intentId: "11111111-2222-3333-4444-555555555555",
  organizationId: "org-1",
  description: "Lagostão · Conta da mesa (PedeAe)",
  amountCents: 5500,
  payer,
  split: { recipientId: "rp_loja", platformRecipientId: "rp_pedeae", platformFeePercent: 5 },
};

describe("Pagar.me: pedido enviado", () => {
  it("Pix: cliente normalizado, expiração e código do pedido = id da intenção", () => {
    const body = buildOrderBody({ ...base, method: "pix", pixExpiresInSeconds: 900 } as CreateOrderInput);
    expect(body.code).toBe(base.intentId);
    expect(body.items).toEqual([{ amount: 5500, description: base.description, quantity: 1, code: "pedeae" }]);
    expect(body.customer).toEqual({
      name: "Ana Souza",
      email: "ana@exemplo.com",
      document: "52998224725",
      document_type: "CPF",
      type: "individual",
      phones: { mobile_phone: { country_code: "55", area_code: "71", number: "998765432" } },
    });
    expect(body.payments[0]).toMatchObject({ payment_method: "pix", pix: { expires_in: 900 } });
    expect(body.metadata).toEqual({ intent_id: base.intentId, organization_id: "org-1" });
  });

  it("cartão: usa o token (nunca os dados do cartão) e o endereço de cobrança", () => {
    const body = buildOrderBody({
      ...base,
      method: "credit_card",
      cardToken: "token_abc",
      billing: { zipCode: "40.140-110", street: "Rua A", number: "10", neighborhood: "Barra", city: "Salvador", state: "ba" },
    } as CreateOrderInput);
    const card = (body.payments[0] as { credit_card: Record<string, unknown> }).credit_card;
    expect(card).toMatchObject({ installments: 1, card_token: "token_abc" });
    expect(card.card).toEqual({ billing_address: { line_1: "10, Rua A, Barra", zip_code: "40140110", city: "Salvador", state: "BA", country: "BR" } });
    expect(JSON.stringify(body)).not.toMatch(/"cvv"|"exp_month"|"holder_name"/);
  });
});

describe("Pagar.me: split", () => {
  it("estabelecimento recebe e é responsável; PedeAe fica com a comissão", () => {
    expect(buildSplit(base.split)).toEqual([
      { amount: 95, type: "percentage", recipient_id: "rp_loja", options: { liable: true, charge_processing_fee: true, charge_remainder_fee: true } },
      { amount: 5, type: "percentage", recipient_id: "rp_pedeae", options: { liable: false, charge_processing_fee: false, charge_remainder_fee: false } },
    ]);
  });

  it("sem recebedor da plataforma (ou comissão 0) o estabelecimento recebe 100%", () => {
    expect(buildSplit({ recipientId: "rp_loja", platformFeePercent: 5 })).toHaveLength(1);
    expect(buildSplit({ recipientId: "rp_loja", platformRecipientId: "rp_pedeae", platformFeePercent: 0 })[0].amount).toBe(100);
    expect(buildSplit({ recipientId: "rp_loja", platformRecipientId: "rp_pedeae", platformFeePercent: 90 })[1].amount).toBe(20); // limite
  });
});

describe("Pagar.me: resposta", () => {
  it("Pix pendente traz o QR; pago traz o valor; recusado traz o motivo", () => {
    expect(
      parseOrder({
        id: "or_1",
        status: "pending",
        charges: [{ status: "pending", last_transaction: { qr_code: "000201...", qr_code_url: "https://x/qr.png", expires_at: "2026-11-18T20:00:00Z" } }],
      }),
    ).toMatchObject({ id: "or_1", status: "pending", paidAmountCents: 0, pix: { qrCode: "000201...", qrCodeUrl: "https://x/qr.png" } });
    expect(parseOrder({ id: "or_2", status: "paid", amount: 5500, charges: [{ status: "paid", paid_amount: 5500 }] })).toMatchObject({ status: "paid", paidAmountCents: 5500 });
    expect(parseOrder({ id: "or_3", status: "failed", charges: [{ status: "failed", last_transaction: { acquirer_message: "Saldo insuficiente" } }] })).toMatchObject({
      status: "failed",
      failureReason: "Saldo insuficiente",
    });
  });
});

describe("simulador", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("só liga sem chave do Pagar.me e com PAYMENTS_SIMULATOR=1; Pix fica pendente até marcar pago", async () => {
    vi.stubEnv("PAGARME_SECRET_KEY", "");
    vi.stubEnv("PAYMENTS_SIMULATOR", "");
    expect(paymentProvider()).toBeNull();
    vi.stubEnv("PAYMENTS_SIMULATOR", "1");
    const sim = paymentProvider()!;
    expect(sim.name).toBe("simulator");

    const pix = await sim.createOrder({ ...base, method: "pix", pixExpiresInSeconds: 900 });
    expect(pix.status).toBe("pending");
    expect(pix.pix?.qrCode).toContain("SIMULADOR");
    markSimulatedPaid(pix.id);
    expect(await sim.getOrder(pix.id)).toMatchObject({ status: "paid", paidAmountCents: 5500 });

    const refused = await sim.createOrder({ ...base, method: "credit_card", cardToken: "tok_recusar", billing: {} as never });
    expect(refused.status).toBe("failed");
    vi.stubEnv("PAGARME_SECRET_KEY", "sk_test_x");
    expect(paymentProvider()!.name).toBe("pagarme"); // chave real sempre vence o simulador
  });
});

describe("dados do pagador", () => {
  it("CPF, celular e e-mail", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(splitPhone("+55 (71) 99876-5432")).toEqual({ countryCode: "55", areaCode: "71", number: "998765432" });
    expect(splitPhone("99876-5432")).toBeNull();
    expect(payerError(payer)).toBeNull();
    expect(payerError({ ...payer, email: "ana" })).toMatch(/e-mail/);
  });
});
