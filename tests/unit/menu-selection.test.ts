import { describe, expect, it } from "vitest";
import { minPriceCents, missingOptions, optionRuleLabel, toggleItem, unitPriceCents, type SelectableProduct } from "@/lib/menu-selection";

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

describe("regras de preço por grupo", () => {
  const pizza: SelectableProduct = {
    price_cents: 0,
    options: [
      {
        id: "sabores",
        name: "Sabores",
        min_select: 1,
        max_select: 2,
        price_rule: "max",
        items: [
          { id: "mus", name: "Mussarela", price_delta_cents: 5200 },
          { id: "cam", name: "Camarão", price_delta_cents: 7600 },
        ],
      },
      { id: "borda", name: "Borda", min_select: 0, max_select: 1, items: [{ id: "cat", name: "Catupiry", price_delta_cents: 1000 }] },
    ],
  };

  it("meio a meio cobra o sabor mais caro e soma a borda", () => {
    expect(unitPriceCents(pizza, { sabores: ["mus", "cam"], borda: ["cat"] })).toBe(8600);
    expect(unitPriceCents(pizza, { sabores: ["mus"] })).toBe(5200);
  });

  it("média arredonda e preço mínimo usa o item mais barato", () => {
    const avg = { ...pizza, options: [{ ...pizza.options[0], price_rule: "avg" as const }] };
    expect(unitPriceCents(avg, { sabores: ["mus", "cam"] })).toBe(6400);
    expect(minPriceCents(pizza)).toBe(5200);
    expect(optionRuleLabel(pizza.options[0])).toBe("Obrigatório · 1 a 2 · vale o preço do mais caro");
  });
});
