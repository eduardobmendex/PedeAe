"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { beep as playBeep, setSoundPreference, useSoundPreference } from "@/lib/alert-sound";
import { createClient } from "@/lib/supabase/client";
import { realtimeClient } from "@/lib/supabase/realtime";

/**
 * Pedidos em tempo real: escuta INSERT/UPDATE em `orders` do estabelecimento (Supabase Realtime,
 * filtrado pelo RLS) e recarrega os dados do servidor. Avisa pedido novo com som, aviso na tela
 * e contador no título da aba. Se o Realtime cair, volta a atualizar a cada 15 s.
 *
 * alertOn:
 *  - "new": todo pedido criado (fila de pedidos e dashboard);
 *  - "kitchen": pedido que entra na fila de preparo (criado já aceito ou aceito depois).
 */
type Alert = "new" | "kitchen";
type OrderRow = { order_number: number; status: string };

const FALLBACK_MS = 15_000;

export function OrdersLive({
  orgId,
  alertOn = "new",
}: {
  orgId: string;
  alertOn?: Alert;
}) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const sound = useSoundPreference();
  const [toast, setToast] = useState<string | null>(null);
  const unseen = useRef(0);

  // Contador de pedidos novos no título da aba enquanto ela está em segundo plano.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    const reset = () => {
      if (document.visibilityState !== "visible") return;
      unseen.current = 0;
      document.title = base;
    };
    document.addEventListener("visibilitychange", reset);
    return () => {
      document.removeEventListener("visibilitychange", reset);
      document.title = base;
    };
  }, []);

  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;

    // Vários eventos seguidos viram um único refresh.
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 300);
    };

    const notify = (row: OrderRow) => {
      setToast(`Novo pedido #${row.order_number}`);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(null), 6000);
      if (soundRef.current) playBeep();
      if (document.visibilityState !== "visible") {
        unseen.current += 1;
        document.title = `(${unseen.current}) ${document.title.replace(/^\(\d+\) /, "")}`;
      }
    };

    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const subscribe = async () => {
      // Sem o token do usuário o Realtime entra como anônimo e o RLS recusa a assinatura.
      // Token do usuário já aplicado ao Realtime (uma vez por página, compartilhado).
      await realtimeClient();
      if (cancelled) return;
      // Tópico único por montagem: remontar (ex.: modo estrito do React) não reaproveita canal fechado.
      channel = supabase
        .channel(`orders:${orgId}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "orders",
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = payload.new as OrderRow;
            if (alertOn === "new" || row.status === "received") notify(row);
            refresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "orders",
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = payload.new as OrderRow;
            // "received" só é alcançado a partir de "aguardando confirmação": é pedido novo para a cozinha.
            if (alertOn === "kitchen" && row.status === "received") notify(row);
            refresh();
          },
        )
        .subscribe((status) => setLive(status === "SUBSCRIBED"));
    };
    void subscribe();

    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      clearTimeout(toastTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [orgId, alertOn, router]);

  // Sem Realtime: atualização periódica, como antes.
  useEffect(() => {
    if (live) return;
    const id = setInterval(
      () => document.visibilityState === "visible" && router.refresh(),
      FALLBACK_MS,
    );
    return () => clearInterval(id);
  }, [live, router]);

  function toggleSound() {
    const next = !sound;
    setSoundPreference(next);
    // O navegador só libera áudio após um clique: este é o clique.
    if (next) playBeep();
  }

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
            live
              ? "bg-success-soft text-success"
              : "bg-warning-soft text-warning"
          }`}
          title={
            live
              ? "Pedidos chegam na hora"
              : "Sem conexão em tempo real: atualizando a cada 15 s"
          }
        >
          <span
            className={`size-2 rounded-full ${live ? "animate-pulse bg-success" : "bg-warning"}`}
          />
          {live ? "Ao vivo" : "Reconectando…"}
        </span>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-muted hover:text-text"
        >
          {sound ? "🔔 Som ligado" : "🔕 Ativar som"}
        </button>
      </div>
      {toast && (
        <div
          role="status"
          className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-brand px-5 py-2.5 font-semibold text-brand-contrast shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
