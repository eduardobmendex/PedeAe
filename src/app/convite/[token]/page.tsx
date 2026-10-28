import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { AcceptInvitationForm } from "./accept-form";

export const instant = false;

export const metadata: Metadata = { title: "Convite" };

export default async function InvitationPage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const user = await requireUser(`/convite/${token}`);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <h1 className="mb-2 text-xl font-semibold">Convite para equipe</h1>
        <p className="mb-6 text-sm text-muted">
          Você está entrando como <strong>{user.email}</strong>. O convite precisa ter sido enviado para este e-mail.
        </p>
        <AcceptInvitationForm token={token} />
      </Card>
    </main>
  );
}
