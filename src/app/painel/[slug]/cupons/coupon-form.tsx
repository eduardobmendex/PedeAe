"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { createCoupon } from "./actions";

export function CouponForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(createCoupon.bind(null, slug), undefined);
  const [kind, setKind] = useState<"percent" | "fixed">("percent");

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Código" htmlFor="c-code" hint="O cliente digita no carrinho. Letras, números, - e _ (3 a 20).">
        <Input
          id="c-code"
          name="code"
          required
          maxLength={20}
          pattern="[A-Za-z0-9_\-]{3,20}"
          autoComplete="off"
          className="uppercase"
        />
      </Field>
      <Field label="Descrição (opcional)" htmlFor="c-desc" hint="Aparece para o cliente, ex.: “10% na primeira visita”.">
        <Input id="c-desc" name="description" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo" htmlFor="c-kind">
          <Select id="c-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "fixed")} className="w-full">
            <option value="percent">Percentual</option>
            <option value="fixed">Valor fixo</option>
          </Select>
        </Field>
        <Field label={kind === "percent" ? "Desconto (%)" : "Desconto (R$)"} htmlFor="c-value">
          <Input id="c-value" name="value" inputMode="decimal" required placeholder={kind === "percent" ? "10" : "5,00"} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pedido mínimo (R$)" htmlFor="c-min">
          <Input id="c-min" name="min_order" inputMode="decimal" placeholder="Sem mínimo" />
        </Field>
        <Field label="Limite de usos" htmlFor="c-max">
          <Input id="c-max" name="max_uses" type="number" min={1} placeholder="Ilimitado" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Válido de" htmlFor="c-from">
          <Input id="c-from" name="valid_from" type="date" />
        </Field>
        <Field label="Até" htmlFor="c-until">
          <Input id="c-until" name="valid_until" type="date" />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando…" : "Criar cupom"}
      </Button>
    </form>
  );
}
