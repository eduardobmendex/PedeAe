"use client";

import { useState, useTransition } from "react";
import { Card, FormMessage } from "@/components/ui";
import type { FormState } from "@/lib/form-state";
import type { ThemeId } from "@/lib/themes";
import { wallpaperStyles, wallpapers, wallpaperUrl, type WallpaperChoice } from "@/lib/wallpapers";
import { saveWallpaper } from "./actions";

/** Papel de parede do cardápio: o estabelecimento escolhe o estilo, a cor segue a identidade visual. */
export function WallpaperSelector({ slug, theme, current }: { slug: string; theme: ThemeId; current: WallpaperChoice }) {
  const [selected, setSelected] = useState(current);
  const [state, setState] = useState<FormState>();
  const [saving, startSaving] = useTransition();

  function choose(choice: WallpaperChoice) {
    if (choice === selected) return;
    const previous = selected;
    setSelected(choice);
    setState(undefined);
    startSaving(async () => {
      const result = await saveWallpaper(slug, choice).catch(() => ({ error: "Sem conexão com o servidor." }));
      if (result?.error) setSelected(previous);
      setState(result);
    });
  }

  const options: { id: WallpaperChoice; label: string; description: string }[] = [
    ...wallpaperStyles.map((id) => ({ id, ...wallpapers[id] })),
    { id: "none", label: "Sem papel de parede", description: "Só a cor de fundo do tema" },
  ];

  return (
    <Card className="mb-6 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Papel de parede do cardápio</h2>
        <p className="text-sm text-muted">
          Aparece nas laterais do cardápio em telas grandes (no celular fica escondido). A cor acompanha a identidade visual.
        </p>
      </div>

      <div role="radiogroup" aria-label="Papel de parede do cardápio" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {options.map(({ id, label, description }) => {
          const on = selected === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={saving}
              onClick={() => choose(id)}
              className={`flex flex-col overflow-hidden rounded-xl border-2 text-left transition disabled:opacity-70 ${
                on ? "border-brand" : "border-border hover:border-border-strong"
              }`}
            >
              <span data-theme={theme} aria-hidden className="block aspect-[2/1] w-full bg-bg">
                {id !== "none" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={wallpaperUrl(id, theme)} alt="" loading="lazy" className="size-full object-cover" />
                )}
              </span>
              <span className="flex flex-1 flex-col bg-surface p-2.5">
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-muted">{description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="text-xs text-muted">
        {saving ? "Salvando…" : ""}
      </p>
      <FormMessage state={state} />
    </Card>
  );
}
