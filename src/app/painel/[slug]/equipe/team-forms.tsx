"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { can, isConfigurable, permissionLabels, permissions } from "@/lib/permissions";
import {
  memberRoles,
  memberStatuses,
  roleLabels,
  statusLabels,
  type MemberRole,
  type MemberStatus,
} from "@/lib/validation";
import { createInvitation, setPermissions, updateMembership } from "./actions";

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(createInvitation.bind(null, slug), undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail" htmlFor="invite-email">
        <Input id="invite-email" name="email" type="email" required />
      </Field>
      <Field label="Papel" htmlFor="invite-role">
        <Select id="invite-role" name="role" defaultValue="staff" className="w-full">
          {memberRoles.map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      {state?.data?.link && (
        <Input readOnly value={state.data.link} onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" />
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Gerando…" : "Gerar link de convite"}
      </Button>
    </form>
  );
}

export function MembershipForm({
  slug,
  membershipId,
  role,
  status,
}: {
  slug: string;
  membershipId: string;
  role: MemberRole;
  status: MemberStatus;
}) {
  const [state, action, pending] = useActionState(updateMembership.bind(null, slug), undefined);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="membershipId" value={membershipId} />
      <Select name="role" defaultValue={role} aria-label="Papel">
        {memberRoles.map((r) => (
          <option key={r} value={r}>
            {roleLabels[r]}
          </option>
        ))}
      </Select>
      <Select name="status" defaultValue={status} aria-label="Status">
        {memberStatuses.map((s) => (
          <option key={s} value={s}>
            {statusLabels[s]}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" disabled={pending}>
        Salvar
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function PermissionsForm({
  slug,
  membershipId,
  role,
  current,
}: {
  slug: string;
  membershipId: string;
  role: MemberRole;
  current: Record<string, boolean>;
}) {
  const [state, action, pending] = useActionState(setPermissions.bind(null, slug, membershipId), undefined);
  const configurable = permissions.filter((p) => isConfigurable(role, p));
  if (configurable.length === 0) return null;

  return (
    <details className="group w-full">
      <summary className="cursor-pointer text-sm text-muted hover:text-text">
        Permissões ajustáveis ({configurable.filter((p) => can({ role, permissions: current }, p)).length}/
        {configurable.length} liberadas)
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-3 rounded-lg bg-surface-2 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {configurable.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="shown" value={p} />
              <input
                type="checkbox"
                name="granted"
                value={p}
                defaultChecked={can({ role, permissions: current }, p)}
                className="size-4 accent-[var(--brand)]"
              />
              {permissionLabels[p]}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            Salvar permissões
          </Button>
          <FormMessage state={state} />
        </div>
      </form>
    </details>
  );
}
