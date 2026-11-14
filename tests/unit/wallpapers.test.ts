import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brandingFrom, DEFAULT_BRANDING_ROW } from "@/lib/theme";
import { identitiesCss, themeIds } from "@/lib/themes";
import { wallpaperStyles, wallpaperUrl } from "@/lib/wallpapers";

describe("papéis de parede do cardápio", () => {
  it("todo estilo tem imagem para todas as identidades", () => {
    for (const style of wallpaperStyles)
      for (const theme of themeIds) expect(existsSync(join("public", wallpaperUrl(style, theme)))).toBe(true);
  });

  it("cada identidade expõe a imagem da sua cor (troca de tema troca a imagem)", () => {
    for (const style of wallpaperStyles)
      for (const theme of themeIds) expect(identitiesCss).toContain(`--wallpaper-${style}:url("${wallpaperUrl(style, theme)}")`);
  });

  it("sem escolha usa o padrão; valor desconhecido também", () => {
    expect(brandingFrom(DEFAULT_BRANDING_ROW).wallpaper).toBe("food");
    expect(brandingFrom({ ...DEFAULT_BRANDING_ROW, settings: { wallpaper: "praia" } }).wallpaper).toBe("food");
    expect(brandingFrom({ ...DEFAULT_BRANDING_ROW, settings: { wallpaper: "none" } }).wallpaper).toBe("none");
  });
});
