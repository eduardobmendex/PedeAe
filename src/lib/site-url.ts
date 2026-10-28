import "server-only";
import { headers } from "next/headers";

/**
 * URL base absoluta usada nos QR Codes e links de convite.
 * Em produção defina NEXT_PUBLIC_SITE_URL; em dev usa o host da requisição
 * (acesse pelo IP da rede local para o celular conseguir abrir o QR).
 */
export async function getSiteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
