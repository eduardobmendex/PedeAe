"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { NavItem } from "./nav";

export function Sidebar({
  orgName,
  roleLabel,
  email,
  items,
  signOutAction,
}: {
  orgName: string;
  roleLabel: string;
  email: string;
  items: NavItem[];
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const home = items[0]?.href;

  const isActive = (href: string) => (href === home ? pathname === href : pathname.startsWith(href));

  return (
    <aside className="border-b border-border bg-surface print:hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:py-5">
        <div className="min-w-0">
          <Link href="/painel" className="text-xs font-medium tracking-wide text-muted uppercase hover:text-text">
            PedeAe
          </Link>
          <p className="truncate font-semibold">{orgName}</p>
          <p className="text-xs text-muted">{roleLabel}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-sm md:hidden"
          aria-expanded={open}
          aria-controls="painel-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Fechar" : "Menu"}
        </button>
      </div>

      <div id="painel-nav" className={`${open ? "flex" : "hidden"} flex-1 flex-col md:flex`}>
        <nav className="flex flex-col gap-0.5 px-2" aria-label="Painel">
          {items.map((item) =>
            item.soon ? (
              <span
                key={item.href}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted/70"
                title="Disponível nas próximas etapas"
              >
                {item.label}
                <span className="text-[10px] tracking-wide uppercase">em breve</span>
              </span>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive(item.href) ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-border p-4">
          <ThemeToggle />
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted" title={email}>
              {email}
            </span>
            <form action={signOutAction}>
              <button type="submit" className="font-medium hover:underline">
                Sair
              </button>
            </form>
          </div>
          <Link href="/painel" className="text-xs text-muted hover:text-text">
            Trocar estabelecimento
          </Link>
        </div>
      </div>
    </aside>
  );
}
