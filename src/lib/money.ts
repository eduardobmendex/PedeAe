const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 1250 -> "R$ 12,50" */
export function formatBRL(cents: number) {
  return brl.format(cents / 100);
}

/** "12,50" | "12.50" | "R$ 1.234,56" -> centavos inteiros; null se inválido. */
export function parseBRL(value: string): number | null {
  const clean = value.replace(/[R$\s]/g, "");
  if (!/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(clean)) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/** 1250 -> "12,50" (para preencher inputs) */
export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}
