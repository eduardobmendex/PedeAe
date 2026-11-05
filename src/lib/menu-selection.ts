// Regras de seleção de adicionais no lado do cliente (experiência).
// O servidor recalcula tudo na criação do pedido — este cálculo nunca é a fonte oficial.

export type PriceRule = "sum" | "max" | "avg";

export type SelectableOption = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  /** Igual a product_options.price_rule; ausente = soma. */
  price_rule?: PriceRule;
  items: { id: string; name: string; price_delta_cents: number }[];
};
export type SelectableProduct = { price_cents: number; options: SelectableOption[] };

/** optionId -> ids dos itens escolhidos */
export type Selection = Record<string, string[]>;

export function toggleItem(selection: Selection, option: SelectableOption, itemId: string): Selection {
  const current = selection[option.id] ?? [];
  if (current.includes(itemId)) return { ...selection, [option.id]: current.filter((id) => id !== itemId) };
  // Escolha única: troca. Múltipla: adiciona até o máximo.
  if (option.max_select === 1) return { ...selection, [option.id]: [itemId] };
  if (current.length >= option.max_select) return selection;
  return { ...selection, [option.id]: [...current, itemId] };
}

/** Grupos obrigatórios que ainda não atingiram o mínimo. */
export function missingOptions(product: SelectableProduct, selection: Selection) {
  return product.options.filter((o) => (selection[o.id]?.length ?? 0) < o.min_select);
}

/** Mesma regra de private.place_order: soma, maior valor ou média arredondada. */
export function groupPriceCents(rule: PriceRule | undefined, prices: number[]) {
  if (prices.length === 0) return 0;
  if (rule === "max") return Math.max(...prices);
  if (rule === "avg") return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  return prices.reduce((a, b) => a + b, 0);
}

export function unitPriceCents(product: SelectableProduct, selection: Selection) {
  let total = product.price_cents;
  for (const option of product.options) {
    const prices = (selection[option.id] ?? []).flatMap((itemId) => {
      const item = option.items.find((i) => i.id === itemId);
      return item ? [item.price_delta_cents] : [];
    });
    total += groupPriceCents(option.price_rule, prices);
  }
  return total;
}

/** Menor preço possível respeitando os grupos obrigatórios (para "a partir de"). */
export function minPriceCents(product: SelectableProduct) {
  let total = product.price_cents;
  for (const option of product.options) {
    if (option.min_select === 0) continue;
    const cheapest = option.items.map((i) => i.price_delta_cents).sort((a, b) => a - b).slice(0, option.min_select);
    total += groupPriceCents(option.price_rule, cheapest);
  }
  return total;
}

export function optionRuleLabel(o: { min_select: number; max_select: number; price_rule?: PriceRule }) {
  const base =
    o.min_select === 0
      ? o.max_select === 1
        ? "Opcional · escolha 1"
        : `Opcional · até ${o.max_select}`
      : o.min_select === o.max_select
        ? `Obrigatório · escolha ${o.min_select}`
        : `Obrigatório · ${o.min_select} a ${o.max_select}`;
  if (o.max_select > 1 && o.price_rule === "max") return `${base} · vale o preço do mais caro`;
  if (o.max_select > 1 && o.price_rule === "avg") return `${base} · vale a média dos preços`;
  return base;
}
