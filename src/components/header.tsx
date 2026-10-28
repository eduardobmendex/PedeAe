import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { getCurrentUser } from "@/lib/auth";
import { ThemeToggle } from "./theme-toggle";

export async function Header({ children }: { children?: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/painel" className="font-semibold">
          PedeAe
        </Link>
        <nav className="flex flex-1 flex-wrap gap-4 text-sm">{children}</nav>
        <ThemeToggle />
        {user && (
          <form action={signOut} className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{user.email}</span>
            <button type="submit" className="underline-offset-4 hover:underline">
              Sair
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
