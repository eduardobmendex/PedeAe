import { describe, expect, it } from "vitest";
import { missingOptions, optionRuleLabel, toggleItem, unitPriceCents, type SelectableProduct } from "@/lib/menu-selection";

const product: SelectableProduct = {
  price_cents: 2000,
  options: [
    {
      id: "size",
      name: "Tamanho",
      min_select: 1,
      max_select: 1,
      items: [
        { id: "m", name: "Médio", price_delta_cents: 0 },
        { id: "g", name: "Grande", price_delta_cents: 500 },
      ],
    },
    {
      id: "extra",
      name: "Extras",
      min_select: 0,
      max_select: 2,
      items: [
        { id: "bacon", name: "Bacon", price_delta_cents: 300 },
        { id: "queijo", name: "Queijo", price_delta_cents: 200 },
        { id: "ovo", name: "Ovo", price_delta_cents: 150 },
      ],
    },
  ],
};
const [size, extra] = product.options;

describe("seleção de adicionais", () => {
  it("escolha única troca o item; múltipla respeita o máximo", () => {
    let s = toggleItem({}, size, "m");
    s = toggleItem(s, size, "g");
    expect(s.size).toEqual(["g"]);

    s = toggleItem(s, extra, "bacon");
    s = toggleItem(s, extra, "queijo");
    s = toggleItem(s, extra, "ovo");
    expect(s.extra).toEqual(["bacon", "queijo"]);

    s = toggleItem(s, extra, "bacon");
    expect(s.extra).toEqual(["queijo"]);
  });

  it("aponta grupos obrigatórios pendentes", () => {
    expect(missingOptions(product, {}).map((o) => o.id)).toEqual(["size"]);
    expect(missingOptions(product, { size: ["m"] })).toEqual([]);
  });

  it("soma os acréscimos ao preço base", () => {
    expect(unitPriceCents(product, { size: ["g"], extra: ["bacon", "queijo"] })).toBe(3000);
    expect(unitPriceCents(product, { size: ["inexistente"] })).toBe(2000);
  });

  it("descreve a regra do grupo", () => {
    expect(optionRuleLabel(size)).toBe("Obrigatório · escolha 1");
    expect(optionRuleLabel(extra)).toBe("Opcional · até 2");
    expect(optionRuleLabel({ min_select: 1, max_select: 3 })).toBe("Obrigatório · 1 a 3");
  });
});
