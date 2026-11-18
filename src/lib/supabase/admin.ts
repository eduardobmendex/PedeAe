import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Cliente com a chave secreta do Supabase (ignora o RLS). Uso EXCLUSIVO do servidor e só
 * para o que não tem usuário logado: confirmar pagamentos online (webhook e verificação).
 */
let admin: SupabaseClient | null = null;
export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  admin ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
