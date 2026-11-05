import type { CSSProperties } from "react";
import { DEFAULT_THEME, identities, isThemeId, type ThemeId } from "./themes";

// Opções aprovadas de tipografia e cantos (guardadas em organization_settings.settings).
export const fonts = {
  geist: { label: "Moderna", css: "var(--font-geist-sans), system-ui, sans-serif" },
  lora: { label: "Clássica", css: "var(--font-lora), Georgia, serif" },
  nunito: { label: "Amigável", css: "var(--font-nunito), system-ui, sans-serif" },
} as const;
export type FontKey = keyof typeof fonts;

export const corners = {
  square: { label: "Retos", radius: "0.25rem" },
  rounded: { label: "Arredondados", radius: "0.75rem" },
  pill: { label: "Bem redondos", radius: "1.25rem" },
} as const;
export type CornerKey = keyof typeof corners;

export type Branding = {
  theme: ThemeId;
  /** Quando true, brand_color/accent_color substituem as cores da identidade. */
  custom_colors: boolean;
  brand_color: string;
  accent_color: string;
  font: FontKey;
  corners: CornerKey;
};

export type BrandingRow = {
  theme: string;
  brand_color: string;
  accent_color: string;
  settings: Record<string, unknown> | null;
};

export const DEFAULT_BRANDING_ROW: BrandingRow = {
  theme: DEFAULT_THEME,
  brand_color: "#E11D48",
  accent_color: "#F59E0B",
  settings: {},
};

/** Normaliza o registro de organization_settings em um Branding completo. */
export function brandingFrom(row: BrandingRow): Branding {
  const font = row.settings?.font;
  const corner = row.settings?.corners;
  return {
    theme: isThemeId(row.theme) ? row.theme : DEFAULT_THEME,
    custom_colors: row.settings?.custom_colors === true,
    brand_color: row.brand_color,
    accent_color: row.accent_color,
    font: typeof font === "string" && font in fonts ? (font as FontKey) : "geist",
    corners: typeof corner === "string" && corner in corners ? (corner as CornerKey) : "rounded",
  };
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Texto (preto ou branco) com melhor contraste sobre a cor informada. */
export function contrastText(hex: string) {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#000000") ? "#ffffff" : "#000000";
}

/** Cor principal efetiva (identidade ou cor própria), para manifest e ícones. */
export function primaryColor(b: Branding) {
  return b.custom_colors ? b.brand_color : identities[b.theme].tokens.primary;
}

/** Variáveis do escopo: fonte e cantos sempre; cores só quando o estabelecimento usa cores próprias. */
export function brandStyle(b: Branding): CSSProperties {
  const base = { "--radius": corners[b.corners].radius, fontFamily: fonts[b.font].css };
  if (!b.custom_colors) return base as CSSProperties;

  const tokens = identities[b.theme].tokens;
  return {
    ...base,
    "--brand": b.brand_color,
    "--brand-contrast": contrastText(b.brand_color),
    // Cor própria só vira texto se continuar legível sobre o fundo da identidade.
    "--brand-text": contrastRatio(b.brand_color, tokens.surface) >= 4.5 ? b.brand_color : tokens.primaryText,
    "--accent": b.accent_color,
    "--accent-contrast": contrastText(b.accent_color),
  } as CSSProperties;
}

/** Contraste da cor própria contra a superfície da identidade (para avisar o admin). */
export function brandContrastOnTheme(brand: string, theme: ThemeId) {
  return contrastRatio(brand, identities[theme].tokens.surface);
}
