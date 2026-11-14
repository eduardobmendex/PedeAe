import type { CSSProperties } from "react";
import { wallpaperVar, type WallpaperChoice } from "@/lib/wallpapers";

// Papel de parede atrás do cardápio público. A imagem vem de --wallpaper-<estilo>, definida
// por cada identidade (themes.ts): trocar DARK/RED/WHITE troca a imagem sem recarregar.
//
// A arte fica nas bordas da imagem, então cada metade da tela ancora a imagem no seu lado
// (altura da tela, largura proporcional) e a coluna do cardápio cobre o centro liso.
// Fixo durante a rolagem, sem cliques, invisível para leitores de tela e na impressão.
// Celular e tablet: escondido (o cardápio ocupa a largura toda). Desktop (lg+): visível.

const HALF = "absolute inset-y-0 w-1/2 bg-no-repeat";

export function MenuFrame({ wallpaper }: { wallpaper: WallpaperChoice }) {
  if (wallpaper === "none") return null;
  const image: CSSProperties = { backgroundImage: wallpaperVar(wallpaper), backgroundSize: "auto 100%" };
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 hidden select-none print:hidden lg:block">
      <div className={`${HALF} left-0`} style={{ ...image, backgroundPosition: "left center" }} />
      <div className={`${HALF} right-0`} style={{ ...image, backgroundPosition: "right center" }} />
    </div>
  );
}
