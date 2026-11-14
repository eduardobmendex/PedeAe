// CSV no formato que o Excel em português abre direto: separador ";", vírgula decimal e BOM UTF-8.

const needsQuotes = /[";\r\n]/;

export function csvCell(value: string | number | null | undefined) {
  const s = value === null || value === undefined ? "" : String(value);
  // Evita que planilhas executem fórmulas vindas de dados digitados pelo cliente.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return needsQuotes.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

/** 12345 centavos -> "123,45" (número, sem "R$", para a planilha somar). */
export const centsCell = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
