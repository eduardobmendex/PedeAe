import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/validation";
import { AuthForms } from "./auth-forms";

export const instant = false;

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, erro } = await searchParams;
  const nextPath = safeNextPath(next);

  if (await getCurrentUser()) redirect(nextPath);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">PedeAe</h1>
        <p className="mb-6 text-sm text-muted">Painel do estabelecimento</p>
        {erro === "link" && (
          <p role="alert" className="mb-4 text-sm text-danger">
            Link de confirmação inválido ou expirado.
          </p>
        )}
        <AuthForms next={nextPath} />
      </Card>
    </main>
  );
}
