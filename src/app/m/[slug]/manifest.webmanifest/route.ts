import { getPublicMenu } from "@/lib/menu";

/**
 * Manifest PWA por estabelecimento. `?start=/q/<token>` faz o app instalado
 * abrir direto na mesa em que o cliente estava.
 */
export async function GET(request: Request, { params }: RouteContext<"/m/[slug]/manifest.webmanifest">) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  if (!menu) return new Response("Not found", { status: 404 });

  const start = new URL(request.url).searchParams.get("start");
  const startUrl = start && /^\/q\/[0-9a-f]{24}$/.test(start) ? start : `/m/${slug}`;
  const dark = menu.branding.theme === "dark";

  const manifest = {
    id: `/m/${slug}`,
    name: `${menu.organization.name} · Cardápio`,
    short_name: menu.organization.name.slice(0, 12),
    description: `Cardápio e pedidos de ${menu.organization.name}`,
    lang: "pt-BR",
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: dark ? "#0b0b0c" : "#f6f6f4",
    theme_color: menu.branding.brand_color,
    icons: [192, 512].map((size) => ({
      src: `/m/${slug}/icon/${size}`,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose: "any maskable",
    })),
  };

  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
