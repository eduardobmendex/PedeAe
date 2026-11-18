"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// Impressão automática da comanda, ligada por aparelho (ex.: o computador da cozinha).
// Cada pedido novo na fila é impresso uma vez, por um iframe invisível que abre a comanda.
// Para sair sem a janela de confirmação, o navegador desse aparelho precisa estar no modo
// quiosque de impressão (Chrome: atalho com --kiosk-printing).

const KEY = "pedeae:auto-print";
const EVENT = "pedeae:auto-print";
const PRINTED_KEY = "pedeae:auto-print:done";

const read = () => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
};
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

function printedSet(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(PRINTED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function savePrinted(s: Set<string>) {
  try {
    sessionStorage.setItem(PRINTED_KEY, JSON.stringify([...s].slice(-300)));
  } catch {}
}

function printTicket(slug: string, orderId: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = `/imprimir/${slug}/pedido/${orderId}`;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 60_000);
}

export function AutoPrintToggle() {
  const on = useSyncExternalStore(subscribe, read, () => false);
  return (
    <label className="flex items-center gap-2 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          try {
            localStorage.setItem(KEY, e.target.checked ? "on" : "off");
          } catch {}
          window.dispatchEvent(new Event(EVENT));
        }}
      />
      Imprimir comanda automaticamente neste aparelho
    </label>
  );
}

/** Imprime a comanda de pedidos que chegam na fila depois que a tela abriu (não reimprime). */
export function useAutoPrint(slug: string, queuedIds: string[]) {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const baseline = useRef<Set<string> | null>(null);

  useEffect(() => {
    // Na primeira renderização, o que já estava na fila não é impresso de novo.
    if (baseline.current === null) {
      baseline.current = new Set(queuedIds);
      return;
    }
    if (!on) {
      for (const id of queuedIds) baseline.current.add(id);
      return;
    }
    const printed = printedSet();
    for (const id of queuedIds) {
      if (baseline.current.has(id) || printed.has(id)) continue;
      baseline.current.add(id);
      printed.add(id);
      printTicket(slug, id);
    }
    savePrinted(printed);
  }, [on, slug, queuedIds]);
}
