"use client";

import { useState, useTransition } from "react";
import { applyScopeTheme } from "@/components/theme-scope";
import { Card, FormMessage } from "@/components/ui";
import { identities, themeIds, type ThemeId } from "@/lib/themes";
import { saveIdentity } from "./actions";

/** Escolha da identidade: muda a tela na hora, salva e recarrega a aplicação; se falhar, volta atrás. */
export function IdentitySelector({ slug, current }: { slug: string; current: ThemeId }) {
  const [selected, setSelected] = useState(current);
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();

  function choose(id: ThemeId) {
    if (id === selected) return;
    const previous = selected;
    setError(undefined);
    setSelected(id);
    applyScopeTheme(id);
    startSaving(async () => {
      const result = await saveIdentity(slug, id).catch(() => ({ error: "Sem conexão com o servidor." }));
      if (result?.error) {
        setSelected(previous);
        applyScopeTheme(previous);
        setError(`${result.error} A identidade anterior foi mantida.`);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <Card className="mb-6 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Identidade Visual</h2>
        <p className="text-sm text-muted">
          Vale para o cardápio dos clientes e para o painel de toda a equipe. Ao escolher, a aplicação recarrega com a nova identidade.
        </p>
      </div>

      <div role="radiogroup" aria-label="Identidade Visual" className="grid gap-4 md:grid-cols-3">
        {themeIds.map((id) => {
          const identity = identities[id];
          const on = selected === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(id)}
              className={`flex flex-col overflow-hidden rounded-xl border-2 text-left transition ${
                on ? "border-brand" : "border-border hover:border-border-strong"
              }`}
            >
              {/* A miniatura usa o próprio tema: mostra exatamente o que será aplicado. */}
              <span data-theme={id} aria-hidden className="flex flex-col gap-2 bg-bg p-3 text-text">
                <span className="flex items-center justify-between rounded-md bg-surface-2 px-2 py-1.5 text-[11px] font-semibold">
                  Cardápio
                  <span className="rounded-full bg-accent px-1.5 text-[9px] text-accent-contrast">novo</span>
                </span>
                <span className="flex items-center justify-between rounded-md border border-border bg-surface px-2 py-2 text-[11px]">
                  <span>
                    <span className="block font-medium">Pizza grande</span>
                    <span className="block text-muted">Até 2 sabores</span>
                  </span>
                  <span className="font-semibold text-brand-text">R$ 52</span>
                </span>
                <span className="rounded-md bg-brand py-1.5 text-center text-[11px] font-semibold text-brand-contrast">
                  Ver pedido
                </span>
              </span>

              <span className="flex flex-1 flex-col gap-2 bg-surface p-3">
                <span className="flex items-center justify-between gap-2">
                  <span>
                    <span className="block font-semibold">{identity.name}</span>
                    <span className="block text-xs text-muted">{identity.tagline}</span>
                  </span>
                  <span
                    aria-hidden
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      on ? "border-brand bg-brand text-brand-contrast" : "border-border-strong"
                    }`}
                  >
                    {on && "✓"}
                  </span>
                </span>
                <span className="text-sm text-muted">{identity.description}</span>
                <span data-theme={id} aria-hidden className="mt-auto flex gap-1.5 bg-transparent">
                  {["bg-bg", "bg-surface-2", "bg-brand", "bg-accent", "bg-text"].map((swatch) => (
                    <span key={swatch} className={`size-5 rounded-full border border-border-strong ${swatch}`} />
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="text-xs text-muted">
        {saving ? "Salvando…" : ""}
      </p>
      <FormMessage state={{ error }} />
    </Card>
  );
}
