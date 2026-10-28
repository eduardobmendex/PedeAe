import { ImageResponse } from "next/og";
import { getPublicMenu } from "@/lib/menu";
import { contrastText } from "@/lib/theme";

/** Ícone do app: inicial do estabelecimento sobre a cor da marca (seguro para máscara). */
export async function GET(_request: Request, { params }: RouteContext<"/m/[slug]/icon/[size]">) {
  const { slug, size } = await params;
  const px = size === "512" ? 512 : 192;
  const menu = await getPublicMenu(slug);
  const brand = menu?.branding.brand_color ?? "#E11D48";
  const initial = (menu?.organization.name.trim()[0] ?? "P").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: brand,
          color: contrastText(brand),
          fontSize: px * 0.5,
          fontWeight: 700,
        }}
      >
        {initial}
      </div>
    ),
    { width: px, height: px, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
