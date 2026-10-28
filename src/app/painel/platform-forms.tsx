"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { memberRoles, roleLabels, slugify } from "@/lib/validation";
import { platformCreateMember, platformCreateOrganization } from "./platform-actions";

export function PlatformCreateOrganizationForm() {
  const [state, action, pending] = useActionState(platformCreateOrganization, undefined);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nome do estabelecimento" htmlFor="p-org-name">
        <Input id="p-org-name" name="name" required onChange={(e) => !slugEdited && setSlug(slugify(e.target.value))} />
      </Field>
      <Field label="Endereço do cardápio" htmlFor="p-org-slug">
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted">/m/</span>
          <Input
            id="p-org-slug"
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

export function PlatformCreateMemberForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(platformCreateMember.bind(null, slug), undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nome" htmlFor="pm-name">
        <Input id="pm-name" name="name" maxLength={120} />
      </Field>
      <Field label="E-mail" htmlFor="pm-email">
        <Input id="pm-email" name="email" type="email" required />
      </Field>
      <Field label="Senha inicial" htmlFor="pm-password" hint="Mínimo 8 caracteres. Ignorada se o e-mail já tiver conta.">
        <Input id="pm-password" name="password" type="text" autoComplete="off" minLength={8} maxLength={72} />
      </Field>
      <Field label="Papel" htmlFor="pm-role">
        <Select id="pm-role" name="role" defaultValue="admin" className="w-full">
          {memberRoles.map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Cadastrando…" : "Cadastrar usuário"}
      </Button>
    </form>
  );
}
