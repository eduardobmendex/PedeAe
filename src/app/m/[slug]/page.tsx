import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PublicMenu } from "@/components/public-menu/public-menu";
import { MenuShell, MenuSkeleton } from "@/components/public-menu/menu-shell";
import { getPublicMenu } from "@/lib/menu";

export async function generateMetadata({ params }: PageProps<"/m/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  return menu
    ? {
        title: { absolute: `${menu.organization.name} · Cardápio` },
        manifest: `/m/${slug}/manifest.webmanifest`,
        appleWebApp: { capable: true, title: menu.organization.name, statusBarStyle: "default" },
        icons: { apple: `/m/${slug}/icon/192` },
      }
    : { title: "Cardápio" };
}

export default function MenuPage({ params }: PageProps<"/m/[slug]">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <MenuLoader params={params} />
    </Suspense>
  );
}

async function MenuLoader({ params }: { params: PageProps<"/m/[slug]">["params"] }) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);
  if (!menu) notFound();

  return (
    <MenuShell menu={menu}>
      <PublicMenu menu={menu} table={null} />
    </MenuShell>
  );
}
