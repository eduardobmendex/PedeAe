"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { createTables, renameTable } from "./actions";

export function CreateTablesForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(createTables.bind(null, slug), undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nome" htmlFor="prefix" hint="Ex.: Mesa 01, Mesa 02… ou Balcão 01">
        <Input id="prefix" name="prefix" defaultValue="Mesa" maxLength={30} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="De" htmlFor="from">
          <Input id="from" name="from" type="number" min={0} max={9999} defaultValue={1} required />
        </Field>
        <Field label="Até" htmlFor="to">
          <Input id="to" name="to" type="number" min={0} max={9999} defaultValue={10} required />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando…" : "Criar mesas"}
      </Button>
    </form>
  );
}

export function RenameTableForm({ slug, id, name }: { slug: string; id: string; name: string }) {
  const [state, action, pending] = useActionState(renameTable.bind(null, slug, id), undefined);

  return (
    <form action={action} className="flex items-center gap-2">
      <Input
        name="name"
        defaultValue={name}
        aria-label="Nome da mesa"
        maxLength={40}
        className="h-8 w-36 font-medium"
        onBlur={(e) => {
          if (e.currentTarget.value.trim() && e.currentTarget.value !== name) e.currentTarget.form?.requestSubmit();
        }}
        disabled={pending}
      />
      {state?.error && <FormMessage state={state} />}
    </form>
  );
}
