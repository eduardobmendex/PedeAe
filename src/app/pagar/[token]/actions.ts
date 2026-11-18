"use server";

import { createPublicClient } from "@/lib/supabase/public";
import { payWithCard, payWithPix, simulatePixPaid, syncIntent, type PayResult } from "@/lib/payments/service";
import type { BillingAddress, Payer, PublicIntent } from "@/lib/payments/types";

const TOKEN = /^[0-9a-f]{32}$/;
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanPayer(p: Payer): Payer {
  return { name: str(p?.name), email: str(p?.email), document: str(p?.document, 20), phone: str(p?.phone, 20) };
}

export async function startPix(token: string, payer: Payer): Promise<PayResult> {
  if (!TOKEN.test(token)) return { ok: false, error: "Pagamento inválido." };
  return payWithPix(token, cleanPayer(payer));
}

export async function startCard(token: string, payer: Payer, cardToken: string, billing: BillingAddress): Promise<PayResult> {
  if (!TOKEN.test(token) || !/^[A-Za-z0-9_-]{3,80}$/.test(cardToken)) return { ok: false, error: "Pagamento inválido." };
  const b: BillingAddress = {
    zipCode: str(billing?.zipCode, 9),
    street: str(billing?.street),
    number: str(billing?.number, 10),
    neighborhood: str(billing?.neighborhood, 60),
    city: str(billing?.city, 60),
    state: str(billing?.state, 2),
  };
  if (b.zipCode.replace(/\D/g, "").length !== 8 || !b.street || !b.number || !b.city || b.state.length !== 2)
    return { ok: false, error: "Preencha o endereço de cobrança do cartão." };
  return payWithCard(token, cleanPayer(payer), cardToken, b);
}

/** Estado atual do pagamento (consulta o Pagar.me se ainda estiver pendente). */
export async function checkPayment(token: string): Promise<PublicIntent | null> {
  if (!TOKEN.test(token)) return null;
  await syncIntent({ token });
  const { data } = await createPublicClient().rpc("get_payment_intent", { p_token: token });
  return (data as PublicIntent | null) ?? null;
}

/** Somente com o simulador ligado (desenvolvimento/testes). */
export async function simulatePaid(token: string): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  return simulatePixPaid(token);
}
