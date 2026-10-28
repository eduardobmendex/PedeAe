"use client";

import { useActionState } from "react";
import { Button, Card, FormMessage } from "@/components/ui";
import { saveServiceSettings } from "./actions";

export function ServiceSettingsForm({ slug, requireConfirmation }: { slug: string; requireConfirmation: boolean }) {
  const [state, action, pending] = useActionState(saveServiceSettings.bind(null, slug), undefined);

  return (
    <Card>
      <form action={action} className="flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Atendimento</h2>
          <p className="text-sm text-muted">Regras para pedidos feitos pelos clientes no QR Code da mesa.</p>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="require_order_confirmation" defaultChecked={requireConfirmation} className="mt-0.5 size-4" />
          <span>
            <span className="block font-medium">Exigir confirmação da equipe</span>
            <span className="text-muted">
              Pedidos do QR Code chegam como “aguardando confirmação” e só entram na fila depois que alguém aceitar.
              Desmarcado, vão direto para a fila de preparo.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            Salvar
          </Button>
          <FormMessage state={state} />
        </div>
      </form>
    </Card>
  );
}
