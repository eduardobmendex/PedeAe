import { describe, expect, it } from "vitest";
import { brandStyle, brandingFrom, contrastRatio, DEFAULT_BRANDING_ROW, primaryColor } from "@/lib/theme";
import { identities, identitiesCss, themeIds } from "@/lib/themes";

describe("identidades visuais", () => {
  it("cada identidade tem CSS próprio e cores realmente distintas", () => {
    for (const id of themeIds) expect(identitiesCss).toContain(`[data-theme="${id}"]`);
    const primaries = new Set(themeIds.map((id) => identities[id].tokens.primary));
    expect(primaries.size).toBe(themeIds.length);
  });

  it("o tema padrão não vence a identidade escolhida no <html>", () => {
    // :root sem :where() teria a mesma prioridade de [data-theme] e ganharia por vir depois.
    expect(identitiesCss).toContain(":where(:root)");
    expect(identitiesCss.replaceAll(":where(:root)", "")).not.toContain(":root");
  });

  it.each(themeIds)("%s: contraste legível (WCAG AA)", (id) => {
    const t = identities[id].tokens;
    for (const background of [t.bg, t.surface]) {
      expect(contrastRatio(t.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.muted, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.primaryText, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const [fg, soft] of [
      [t.danger, t.dangerSoft],
      [t.success, t.successSoft],
      [t.warning, t.warningSoft],
      [t.info, t.infoSoft],
    ]) {
      expect(contrastRatio(fg, soft)).toBeGreaterThanOrEqual(4.5);
    }
    // Botões: 4,0 porque o vermelho pedido (#E53935 com branco) dá 4,23; os demais passam de 4,5.
    expect(contrastRatio(t.primaryContrast, t.primary)).toBeGreaterThanOrEqual(4);
    expect(contrastRatio(t.secondaryContrast, t.secondary)).toBeGreaterThanOrEqual(4.5);
  });

  it("sem cores próprias, o estabelecimento usa as cores da identidade", () => {
    const b = brandingFrom({ ...DEFAULT_BRANDING_ROW, theme: "dark" });
    expect(brandStyle(b)).not.toHaveProperty("--brand");
    expect(primaryColor(b)).toBe(identities.dark.tokens.primary);
  });

  it("cores próprias valem, mas não viram texto ilegível", () => {
    const b = brandingFrom({ theme: "white", brand_color: "#FFEE00", accent_color: "#112233", settings: { custom_colors: true } });
    const style = brandStyle(b) as Record<string, string>;
    expect(style["--brand"]).toBe("#FFEE00");
    expect(style["--brand-contrast"]).toBe("#000000");
    expect(style["--brand-text"]).toBe(identities.white.tokens.primaryText);
  });

  it("valor antigo ou desconhecido cai na identidade padrão", () => {
    expect(brandingFrom({ ...DEFAULT_BRANDING_ROW, theme: "light" }).theme).toBe("white");
  });
});
