"use client";

import { useSyncExternalStore } from "react";

// Carrinho do cliente, guardado no navegador por mesa. Os preços aqui são só
// para exibição: o servidor recalcula tudo ao criar o pedido.

export type CartLineOption = { option_id: string; item_ids: string[] };

export type CartLine = {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  notes: string;
  options: CartLineOption[];
  optionLabels: string[];
  unitPriceCents: number;
};

export type CartState = {
  lines: CartLine[];
  customerName: string;
  notes: string;
  /** Chave de idempotência reutilizada em reenvios do MESMO carrinho. */
  pendingKey: string | null;
};

const EMPTY: CartState = { lines: [], customerName: "", notes: "", pendingKey: null };

type Store = {
  state: CartState;
  listeners: Set<() => void>;
};

const stores = new Map<string, Store>();

function load(storageKey: string): CartState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<CartState>;
    return { ...EMPTY, ...parsed, lines: Array.isArray(parsed.lines) ? parsed.lines : [] };
  } catch {
    return EMPTY;
  }
}

function getStore(storageKey: string): Store {
  let store = stores.get(storageKey);
  if (!store) {
    store = { state: typeof window === "undefined" ? EMPTY : load(storageKey), listeners: new Set() };
    stores.set(storageKey, store);
  }
  return store;
}

function update(storageKey: string, fn: (s: CartState) => CartState) {
  const store = getStore(storageKey);
  store.state = fn(store.state);
  try {
    localStorage.setItem(storageKey, JSON.stringify(store.state));
  } catch {}
  store.listeners.forEach((l) => l());
}

/** Alterar o carrinho invalida a chave pendente: é um pedido diferente. */
const edit = (fn: (s: CartState) => Partial<CartState>) => (s: CartState) => ({ ...s, ...fn(s), pendingKey: null });

const sameLine = (a: CartLine, b: Omit<CartLine, "key" | "quantity">) =>
  a.productId === b.productId && a.notes === b.notes && JSON.stringify(a.options) === JSON.stringify(b.options);

export function useCart(storageKey: string) {
  const state = useSyncExternalStore(
    (cb) => {
      const store = getStore(storageKey);
      store.listeners.add(cb);
      return () => store.listeners.delete(cb);
    },
    () => getStore(storageKey).state,
    () => EMPTY,
  );

  return {
    state,
    count: state.lines.reduce((n, l) => n + l.quantity, 0),
    totalCents: state.lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0),

    add(line: Omit<CartLine, "key">) {
      update(
        storageKey,
        edit((s) => {
          const existing = s.lines.find((l) => sameLine(l, line));
          if (existing) {
            return {
              lines: s.lines.map((l) => (l === existing ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l)),
            };
          }
          return { lines: [...s.lines, { ...line, key: crypto.randomUUID() }] };
        }),
      );
    },
    setQuantity(key: string, quantity: number) {
      update(
        storageKey,
        edit((s) => ({
          lines:
            quantity <= 0
              ? s.lines.filter((l) => l.key !== key)
              : s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l)),
        })),
      );
    },
    setField(field: "customerName" | "notes", value: string) {
      update(storageKey, (s) => ({ ...s, [field]: value }));
    },
    /** Retorna a chave de idempotência do envio atual (cria se não houver). */
    ensureKey(): string {
      const current = getStore(storageKey).state.pendingKey;
      if (current) return current;
      const key = crypto.randomUUID();
      update(storageKey, (s) => ({ ...s, pendingKey: key }));
      return key;
    },
    clear() {
      update(storageKey, () => EMPTY);
    },
  };
}

// ---------------------------------------------------------------- Pedidos recentes

export type RecentOrder = { token: string; number: number; at: number };
const RECENT_MS = 12 * 60 * 60 * 1000;

export function rememberOrder(slug: string, order: RecentOrder) {
  try {
    const key = `pedeae:orders:${slug}`;
    const list = recentOrders(slug).filter((o) => o.token !== order.token);
    localStorage.setItem(key, JSON.stringify([order, ...list].slice(0, 10)));
  } catch {}
}

export function recentOrders(slug: string): RecentOrder[] {
  try {
    const list = JSON.parse(localStorage.getItem(`pedeae:orders:${slug}`) ?? "[]") as RecentOrder[];
    return list.filter((o) => Date.now() - o.at < RECENT_MS);
  } catch {
    return [];
  }
}

const NO_ORDERS: RecentOrder[] = [];
const recentCache = new Map<string, { raw: string | null; value: RecentOrder[] }>();

/** Pedidos recentes deste aparelho (lido do localStorage sem efeito colateral no render). */
export function useRecentOrders(slug: string): RecentOrder[] {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(`pedeae:orders:${slug}`);
      } catch {}
      const cached = recentCache.get(slug);
      if (cached && cached.raw === raw) return cached.value;
      const value = raw ? recentOrders(slug) : NO_ORDERS;
      recentCache.set(slug, { raw, value });
      return value;
    },
    () => NO_ORDERS,
  );
}
