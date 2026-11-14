"use client";

import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui";
import { switchMenuType } from "./actions";

type EstablishmentType = { id: string; name: string; description: string };

/** Troca o tipo do cardápio com os produtos padrão do tipo escolhido (pede confirmação). */
export function MenuTypeSwitcher({ slug, types, current }: { slug: string; types: EstablishmentType[]; current: string | null }) {
  const [target, setTarget] = useState(current ?? types[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>();
  const [pending, startTransition] = useTransition();
  const currentName = types.find((t) => t.id === current)?.name;
  const targetType = types.find((t) => t.id === target);

  function run() {
    setMessage(undefined);
    startTransition(async () => {
      const result = await switchMenuType(slug, target).catch(() => ({ ok: false as const, error: "Sem conexão com o servidor." }));
      setConfirming(false);
      setMessage(
        result.ok
          ? {
              success: `Cardápio trocado para ${targetType?.name}. ${result.imported} produto(s) novo(s) e ${result.published} categoria(s) publicada(s).`,
            }
          : { error: result.error },
      );
    });
  }

  return (
    <Card className="mb-6 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Tipo do cardápio</h2>
        <p className="text-sm text-muted">
          {currentName ? (
            <>
              Atual: <strong className="text-text">{currentName}</strong>.{" "}
            </>
          ) : null}
          Ao trocar, o cardápio passa a mostrar os produtos padrão do novo tipo e o papel de parede combina com ele. Nada é
          apagado: o que não for do novo tipo fica oculto e volta se você trocar de novo, com os preços que você editou.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium">
          Novo tipo
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setConfirming(false);
            }}
            disabled={pending}
            className="h-10 rounded-lg border border-input-border bg-input px-3 text-base"
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === current ? " (atual)" : ""}
              </option>
            ))}
          </select>
        </label>
        {!confirming && (
          <Button type="button" onClick={() => setConfirming(true)} disabled={!target || pending}>
            Trocar cardápio
          </Button>
        )}
      </div>
      {targetType && <p className="-mt-2 text-xs text-muted">{targetType.description}</p>}

      {confirming && (
        <div role="alertdialog" aria-label="Confirmar troca" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          <p>
            Trocar para <strong>{targetType?.name}</strong>? Os clientes passam a ver o novo cardápio na hora.
          </p>
          <span className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={run} disabled={pending}>
              {pending ? "Trocando…" : "Confirmar troca"}
            </Button>
          </span>
        </div>
      )}

      {message?.success && (
        <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-sm text-success">
          {message.success}
        </p>
      )}
      {message?.error && (
        <p role="alert" className="text-sm text-danger">
          {message.error}
        </p>
      )}
    </Card>
  );
}
