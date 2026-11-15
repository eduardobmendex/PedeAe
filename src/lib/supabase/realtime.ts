"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./client";

let ready: Promise<SupabaseClient> | null = null;

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * Cliente do navegador pronto para o Realtime, compartilhado por todos os componentes da página.
 *
 * O token do usuário precisa estar no Realtime ANTES de assinar canais: sem ele a assinatura
 * entra como anônima e o RLS recusa. Fazer isso uma vez só evita que dois componentes
 * (pedidos e chamados) disputem a sessão ao mesmo tempo, o que travava a conexão.
 */
export function realtimeClient(): Promise<SupabaseClient> {
  ready ??= (async () => {
    const supabase = createClient();
    const session = await withTimeout(supabase.auth.getSession(), 8000);
    const token = session?.data.session?.access_token;
    // Sem resposta a tempo, deixa o próprio cliente buscar o token ao conectar.
    await (token ? supabase.realtime.setAuth(token) : supabase.realtime.setAuth());
    return supabase;
  })().catch((error) => {
    ready = null; // próxima tentativa recomeça
    throw error;
  });
  return ready;
}
