"use client";

import { useSyncExternalStore } from "react";

// Preferência de tema do PAINEL (por navegador). O cardápio público usa o tema
// escolhido pelo estabelecimento, independente desta preferência.

const STORAGE_KEY = "pedeae-theme";
type Pref = "light" | "dark" | "system";

/** Script inline que aplica o tema antes da pintura, evitando flash. */
export const themeInitScript = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();

function read(): Pref {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(pref: Pref) {
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {}
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
  listeners.forEach((l) => l());
}

const options: { value: Pref; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Auto" },
];

export function ThemeToggle() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "system" as Pref,
  );

  return (
    <div role="radiogroup" aria-label="Tema do painel" className="flex rounded-lg bg-surface-2 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => apply(o.value)}
          className={`flex-1 rounded-md px-2.5 py-1 font-medium transition ${
            pref === o.value ? "bg-surface text-text shadow-card" : "text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
