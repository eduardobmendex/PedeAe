import { describe, expect, it } from "vitest";
import { centsToInput, formatBRL, parseBRL } from "@/lib/money";

describe("dinheiro", () => {
  it("interpreta valores em reais para centavos", () => {
    expect(parseBRL("12,50")).toBe(1250);
    expect(parseBRL("12.5")).toBe(1250);
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("0,1")).toBe(10);
    expect(parseBRL("10")).toBe(1000);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("-5")).toBeNull();
    expect(parseBRL("1,234")).toBeNull();
  });

  it("formata centavos", () => {
    expect(formatBRL(1250).replace(/\s/g, " ")).toBe("R$ 12,50");
    expect(centsToInput(1205)).toBe("12,05");
  });
});
