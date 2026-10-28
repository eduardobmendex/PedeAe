// Regras de seleção de adicionais no lado do cliente (experiência).
// O servidor recalcula tudo na criação do pedido — este cálculo nunca é a fonte oficial.

export type SelectableOption = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
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

export function unitPriceCents(product: SelectableProduct, selection: Selection) {
  let total = product.price_cents;
  for (const option of product.options) {
    for (const itemId of selection[option.id] ?? []) {
      total += option.items.find((i) => i.id === itemId)?.price_delta_cents ?? 0;
    }
  }
  return total;
}

export function optionRuleLabel(o: { min_select: number; max_select: number }) {
  if (o.min_select === 0) return o.max_select === 1 ? "Opcional · escolha 1" : `Opcional · até ${o.max_select}`;
  if (o.min_select === o.max_select) return `Obrigatório · escolha ${o.min_select}`;
  return `Obrigatório · ${o.min_select} a ${o.max_select}`;
}
