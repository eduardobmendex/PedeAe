import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/**
 * Cliente anônimo, sem cookies: lê apenas o que é público (RPCs get_public_menu,
 * resolve_table_token). Pode ser usado dentro de 'use cache'.
 */
export function createPublicClient() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
