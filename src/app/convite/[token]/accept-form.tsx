"use client";

import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { acceptInvitation } from "./actions";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitation.bind(null, token), undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Aceitando…" : "Aceitar convite"}
      </Button>
    </form>
  );
}
