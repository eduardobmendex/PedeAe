// Tipos e validações compartilhados (cliente e servidor) dos pagamentos online.

export type Payer = { name: string; email: string; document: string; phone: string };
export type BillingAddress = { zipCode: string; street: string; number: string; neighborhood: string; city: string; state: string };

export type IntentStatus = "pending" | "paid" | "failed" | "cancelled" | "expired";

export type PublicIntent = {
  id: string;
  kind: "tab" | "order";
  amount_cents: number;
  status: IntentStatus;
  method: "pix" | "credit_card" | null;
  expires_at: string;
  pix_qr_code: string | null;
  pix_qr_code_url: string | null;
  pix_expires_at: string | null;
  failure_reason: string | null;
  organization: { id: string; name: string; slug: string };
  table_name: string | null;
  order: { number: number; public_token: string; status: string } | null;
};

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** CPF com dígitos verificadores válidos. */
export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** CNPJ com dígitos verificadores válidos. */
export function isValidCnpj(value: string) {
  const c = onlyDigits(value);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((n, w, i) => n + w * Number(c[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(c[12]) && digit(13) === Number(c[13]);
}

/** Celular brasileiro com DDD: 10 ou 11 dígitos (sem o +55). */
export function splitPhone(value: string) {
  let d = onlyDigits(value);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return { countryCode: "55", areaCode: d.slice(0, 2), number: d.slice(2) };
}

export function payerError(p: Payer): string | null {
  if (p.name.trim().length < 3) return "Informe seu nome completo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) return "Informe um e-mail válido.";
  if (!isValidCpf(p.document)) return "CPF inválido.";
  if (!splitPhone(p.phone)) return "Informe o celular com DDD.";
  return null;
}
