"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { slugify } from "@/lib/validation";
import { createOrganization } from "./actions";

export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nome do estabelecimento" htmlFor="org-name">
        <Input
          id="org-name"
          name="name"
          required
          onChange={(e) => !slugEdited && setSlug(slugify(e.target.value))}
        />
      </Field>
      <Field label="Endereço do cardápio" htmlFor="org-slug">
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted">/m/</span>
          <Input
            id="org-slug"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
          />
        </div>
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando…" : "Criar estabelecimento"}
      </Button>
    </form>
  );
}
