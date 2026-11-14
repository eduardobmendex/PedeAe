// Papéis de parede do cardápio público. O estabelecimento escolhe o estilo; a cor
// segue a identidade visual: cada tema expõe --wallpaper-<estilo> (veja themes.ts),
// então trocar DARK/RED/WHITE troca a imagem na hora, sem recarregar.
//
// Arquivos: public/wallpapers/<estilo>-<tema>.webp, gerados a partir de
// assets/theme_moldura/ por `node scripts/build-wallpapers.mjs`.
// O banco também lista os estilos aceitos (set_organization_wallpaper).

export const wallpapers = {
  food: { label: "Food", description: "Lanches, pizzas e pratos variados" },
  bar: { label: "Bar", description: "Cerveja, petiscos e espetinhos" },
  pizzaria: { label: "Pizzaria", description: "Pizzas" },
  restaurante: { label: "Restaurante", description: "Pratos feitos e refeições" },
} as const;

export type WallpaperStyle = keyof typeof wallpapers;
export type WallpaperChoice = WallpaperStyle | "none";

export const wallpaperStyles = Object.keys(wallpapers) as WallpaperStyle[];
export const DEFAULT_WALLPAPER: WallpaperChoice = "food";

export const isWallpaperChoice = (value: unknown): value is WallpaperChoice =>
  value === "none" || (typeof value === "string" && value in wallpapers);

export const wallpaperUrl = (style: WallpaperStyle, theme: string) => `/wallpapers/${style}-${theme}.webp`;

/** Variável CSS com a imagem do estilo no tema ativo. */
export const wallpaperVar = (style: WallpaperStyle) => `var(--wallpaper-${style})`;
