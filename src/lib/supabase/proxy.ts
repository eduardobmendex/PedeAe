import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

const PROTECTED_PREFIXES = ["/painel", "/convite"];

/**
 * Renova a sessão do Supabase e faz o redirecionamento otimista para o login.
 * A autorização de verdade acontece no servidor (páginas/actions) e no RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Não colocar código entre a criação do cliente e getClaims(): é aqui que a sessão é renovada.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  // Só navegações: uma Server Action (POST) não entende redirect comum e falha com
  // "unexpected response". As actions validam a sessão e redirecionam por conta própria.
  const isNavigation = request.method === "GET" || request.method === "HEAD";
  if (isNavigation && !isLoggedIn && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}
