import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">PedeAe</h1>
      <p className="text-lg text-muted">
        Cardápio digital e pedidos por QR Code para restaurantes, bares, pastelarias e hamburguerias.
      </p>
      <div>
        <Link
          href="/painel"
          className={buttonClass("primary", "h-11 px-5")}
        >
          Acessar o painel
        </Link>
      </div>
    </main>
  );
}
