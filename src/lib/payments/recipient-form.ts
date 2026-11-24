// Formulário "Iniciar KYC": dados do estabelecimento para criar o recebedor no Pagar.me.
// Pessoa física (individual) ou jurídica (corporation, com um sócio administrador).
import { z } from "zod";
import { parseBRL } from "@/lib/money";
import { isValidCnpj, isValidCpf, onlyDigits, splitPhone } from "./types";

const text = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max);
const optional = (max: number) => z.string().trim().max(max).optional().default("");
const money = (label: string) =>
  z.string().transform((v, ctx) => {
    const cents = parseBRL(v);
    if (cents === null || cents <= 0) {
      ctx.addIssue({ code: "custom", message: `${label}: informe um valor em reais` });
      return z.NEVER;
    }
    return cents;
  });
/** <input type="date"> → "AAAA-MM-DD", no passado. */
const pastDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: informe a data`)
    .refine((d) => d < new Date().toISOString().slice(0, 10) && d > "1900-01-01", `${label}: data inválida`);
const phone = (label: string) =>
  z.string().refine((v) => splitPhone(v) !== null, `${label}: informe o celular com DDD`);
const cpf = (label: string) => z.string().refine(isValidCpf, `${label}: CPF inválido`).transform(onlyDigits);

const address = {
  zip_code: z.string().transform(onlyDigits).refine((v) => v.length === 8, "CEP: 8 dígitos"),
  street: text(2, 120, "Rua: obrigatório"),
  street_number: text(1, 20, "Número: obrigatório"),
  complementary: optional(80),
  neighborhood: text(2, 80, "Bairro: obrigatório"),
  city: text(2, 80, "Cidade: obrigatória"),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "UF: 2 letras"),
  reference_point: optional(120),
};

const common = {
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  phone: phone("Telefone"),
  site_url: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^https?:\/\/\S+\.\S+/.test(v), "Site: comece com http:// ou https://")
    .optional()
    .default(""),
  ...address,
  // Conta bancária (titular = o próprio recebedor: mesmo CPF/CNPJ).
  holder_name: text(3, 30, "Titular da conta: obrigatório (até 30 letras)"),
  bank: z.string().trim().regex(/^\d{3}$/, "Banco: código de 3 dígitos (ex.: 001, 260, 341)"),
  branch_number: z.string().trim().regex(/^\d{1,4}$/, "Agência: até 4 dígitos, sem o dígito"),
  branch_check_digit: z.string().trim().regex(/^[0-9xX]?$/, "Dígito da agência: 1 caractere").optional().default(""),
  account_number: z.string().trim().regex(/^\d{1,13}$/, "Conta: até 13 dígitos, sem o dígito"),
  account_check_digit: z.string().trim().regex(/^[0-9xX]{1,2}$/, "Dígito da conta: obrigatório"),
  account_type: z.enum(["checking", "savings"]),
  transfer_interval: z.enum(["Daily", "Weekly", "Monthly"]),
  transfer_day: z.coerce.number().int().min(0).max(31),
};

export const individualSchema = z.object({
  kind: z.literal("individual"),
  name: text(5, 120, "Nome completo: obrigatório"),
  document: cpf("CPF"),
  mother_name: optional(120),
  birthdate: pastDate("Nascimento"),
  monthly_income: money("Renda mensal"),
  professional_occupation: text(2, 80, "Profissão: obrigatória"),
  ...common,
});

export const corporationSchema = z.object({
  kind: z.literal("corporation"),
  company_name: text(2, 120, "Razão social: obrigatória"),
  trading_name: text(2, 120, "Nome fantasia: obrigatório"),
  document: z.string().refine(isValidCnpj, "CNPJ inválido").transform(onlyDigits),
  annual_revenue: money("Faturamento anual"),
  corporation_type: z.enum(["MEI", "EI", "EIRELI", "LTDA", "SLU", "SA", "SS", "OUTRO"]),
  founding_date: pastDate("Data de abertura"),
  partner_name: text(5, 120, "Sócio: nome completo obrigatório"),
  partner_document: cpf("CPF do sócio"),
  partner_email: z.string().trim().toLowerCase().email("E-mail do sócio inválido"),
  partner_birthdate: pastDate("Nascimento do sócio"),
  partner_monthly_income: money("Renda mensal do sócio"),
  partner_occupation: text(2, 80, "Profissão do sócio: obrigatória"),
  partner_mother_name: optional(120),
  partner_phone: phone("Celular do sócio"),
  ...common,
});

export const recipientFormSchema = z.discriminatedUnion("kind", [individualSchema, corporationSchema]);
export type RecipientForm = z.infer<typeof recipientFormSchema>;
