import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="max-w-sm text-muted">
        O endereço pode estar incorreto, ou você não tem acesso a este estabelecimento.
      </p>
      <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">
        Voltar ao início
      </Link>
    </main>
  );
}
