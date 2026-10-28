import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicMenu } from "@/components/public-menu/public-menu";
import { MenuNotice, MenuShell, MenuSkeleton } from "@/components/public-menu/menu-shell";
import { getPublicMenu, resolveTableToken } from "@/lib/menu";

export async function generateMetadata({ params }: PageProps<"/q/[token]">): Promise<Metadata> {
  const { token } = await params;
  const table = await resolveTableToken(token);
  if (!table) return { title: "Cardápio", robots: { index: false } };
  return {
    title: { absolute: `${table.table_name} · Cardápio` },
    robots: { index: false },
    manifest: `/m/${table.slug}/manifest.webmanifest?start=/q/${token}`,
    appleWebApp: { capable: true, statusBarStyle: "default" },
    icons: { apple: `/m/${table.slug}/icon/192` },
  };
}

/** Destino do QR Code de mesa: valida o token no servidor a cada acesso. */
export default function TableMenuPage({ params }: PageProps<"/q/[token]">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <TableMenuLoader params={params} />
    </Suspense>
  );
}

async function TableMenuLoader({ params }: { params: PageProps<"/q/[token]">["params"] }) {
  const { token } = await params;
  const table = await resolveTableToken(token);
  if (!table) {
    return (
      <MenuNotice title="QR Code inválido">
        Este código foi desativado ou substituído. Peça ajuda a um atendente para fazer seu pedido.
      </MenuNotice>
    );
  }

  const menu = await getPublicMenu(table.slug);
  if (!menu) {
    return <MenuNotice title="Cardápio indisponível">Tente novamente em alguns instantes.</MenuNotice>;
  }

  return (
    <MenuShell menu={menu}>
      <PublicMenu menu={menu} table={{ name: table.table_name, token }} />
    </MenuShell>
  );
}
