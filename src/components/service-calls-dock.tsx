"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { resolveServiceCall } from "@/app/painel/[slug]/service-actions";
import { beep, soundEnabled } from "@/lib/alert-sound";
import { createClient } from "@/lib/supabase/client";
import { realtimeClient } from "@/lib/supabase/realtime";

type Call = { id: string; kind: "waiter" | "bill"; created_at: string; table_id: string; tables: { name: string } | null };

const LABEL = { waiter: "chamou o garçom", bill: "pediu a conta" } as const;

/**
 * Chamados das mesas (garçom / conta) em todas as telas do painel: aparecem na hora
 * (Supabase Realtime, filtrado pelo RLS), tocam o alerta e somem ao marcar "Atendido".
 */
export function ServiceCallsDock({ orgId, slug, canOpenTabs }: { orgId: string; slug: string; canOpenTabs: boolean }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // Minimizado vira uma barrinha (não cobre botões da página); chamado novo abre de novo.
  const [collapsed, setCollapsed] = useState(false);
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("service_calls")
      .select("id, kind, created_at, table_id, tables (name)")
      .eq("organization_id", orgId)
      .eq("status", "open")
      .order("created_at");
    const list = (data ?? []) as unknown as Call[];
    // Toca só para chamados novos (ou reavisos), não para os que já estavam na tela.
    const keys = new Set(list.map((c) => `${c.id}@${c.created_at}`));
    if (known.current && [...keys].some((k) => !known.current!.has(k))) {
      setCollapsed(false);
      if (soundEnabled()) beep("call");
    }
    known.current = keys;
    setCalls(list);
  }, [orgId]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      await realtimeClient();
      if (cancelled) return;
      await load();
      if (cancelled) return;
      channel = supabase
        .channel(`calls:${orgId}:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "service_calls", filter: `organization_id=eq.${orgId}` }, () => void load())
        .subscribe();
    })();

    // Reserva: se o Realtime cair, a lista ainda se atualiza.
    const poll = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [orgId, load]);

  if (calls.length === 0) return null;

  return (
    <aside
      aria-label="Chamados das mesas"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-end gap-2 print:hidden"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-contrast shadow-lg"
      >
        🔔 {calls.length} chamado{calls.length > 1 ? "s" : ""} {collapsed ? "· mostrar" : "· minimizar"}
      </button>
      {!collapsed && calls.map((c) => (
        <CallCard key={c.id} call={c} slug={slug} now={now} canOpenTabs={canOpenTabs} onDone={() => setCalls((l) => l.filter((x) => x.id !== c.id))} />
      ))}
    </aside>
  );
}

function CallCard({ call, slug, now, canOpenTabs, onDone }: { call: Call; slug: string; now: number; canOpenTabs: boolean; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const minutes = Math.max(0, Math.floor((now - new Date(call.created_at).getTime()) / 60000));

  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-brand bg-surface p-3 shadow-lg">
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-lg text-brand-contrast">
        {call.kind === "waiter" ? "🔔" : "🧾"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {call.tables?.name ?? "Mesa"} {LABEL[call.kind]}
        </p>
        <p className="text-xs text-muted">{minutes === 0 ? "agora" : `há ${minutes} min`}</p>
        {call.kind === "bill" && canOpenTabs && (
          <Link href={`/painel/${slug}/contas?mesa=${call.table_id}`} className="text-xs font-semibold text-brand-text hover:underline">
            Abrir a conta →
          </Link>
        )}
        {error && <p className="text-xs text-danger">Não foi possível marcar. Tente de novo.</p>}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await resolveServiceCall(slug, call.id).catch(() => ({ ok: false }));
            if (r.ok) onDone();
            else setError(true);
          })
        }
        className="h-9 shrink-0 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-contrast disabled:opacity-60"
      >
        {pending ? "…" : "Atendido"}
      </button>
    </div>
  );
}
