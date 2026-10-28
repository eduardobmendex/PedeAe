"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { signIn, signUp } from "./actions";

export function AuthForms({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInAction, signingIn] = useActionState(signIn, undefined);
  const [signUpState, signUpAction, signingUp] = useActionState(signUp, undefined);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 rounded-lg bg-surface-2 p-1 text-sm">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md py-2 font-medium ${mode === m ? "bg-surface shadow-card" : "text-muted"}`}
          >
            {m === "signin" ? "Entrar" : "Criar conta"}
          </button>
        ))}
      </div>

      {mode === "signin" ? (
        <form action={signInAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Field label="E-mail" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Senha" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <FormMessage state={signInState} />
          <Button type="submit" disabled={signingIn}>
            {signingIn ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      ) : (
        <form action={signUpAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Nome" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field label="E-mail" htmlFor="su-email">
            <Input id="su-email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Senha (mín. 8 caracteres)" htmlFor="su-password">
            <Input id="su-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <FormMessage state={signUpState} />
          <Button type="submit" disabled={signingUp}>
            {signingUp ? "Criando…" : "Criar conta"}
          </Button>
        </form>
      )}
    </div>
  );
}
