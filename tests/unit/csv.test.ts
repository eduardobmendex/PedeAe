import { describe, expect, it } from "vitest";
import { centsCell, csvCell, toCsv } from "@/lib/csv";

describe("CSV", () => {
  it("abre no Excel em português: BOM, ponto e vírgula e vírgula decimal", () => {
    const csv = toCsv(["Produto", "Total"], [["Pizza", centsCell(4590)]]);
    expect(csv).toBe("﻿Produto;Total\r\nPizza;45,90\r\n");
  });

  it("protege separadores, aspas e quebras de linha", () => {
    expect(csvCell('X-Tudo; "grande"')).toBe('"X-Tudo; ""grande"""');
    expect(csvCell("linha 1\nlinha 2")).toBe('"linha 1\nlinha 2"');
    expect(csvCell(null)).toBe("");
  });

  it("não deixa nome digitado pelo cliente virar fórmula na planilha", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+5511")).toBe("'+5511");
  });
});
