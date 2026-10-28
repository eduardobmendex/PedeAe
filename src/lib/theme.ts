import type { CSSProperties } from "react";

export const themes = ["light", "dark"] as const;
export type Theme = (typeof themes)[number];
export const themeLabels: Record<Theme, string> = { light: "White", dark: "Black" };

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
  theme: Theme;
  brand_color: string;
  accent_color: string;
  font: FontKey;
  corners: CornerKey;
};

/** Normaliza o registro de organization_settings em um Branding completo. */
export function brandingFrom(row: {
  theme: string;
  brand_color: string;
  accent_color: string;
  settings: Record<string, unknown> | null;
}): Branding {
  const font = row.settings?.font;
  const corner = row.settings?.corners;
  return {
    theme: row.theme === "dark" ? "dark" : "light",
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
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#18181b") ? "#ffffff" : "#18181b";
}

/** Variáveis CSS da marca para aplicar num container com data-theme. */
export function brandStyle(b: Branding): CSSProperties {
  return {
    "--brand": b.brand_color,
    "--brand-contrast": contrastText(b.brand_color),
    "--accent": b.accent_color,
    "--accent-contrast": contrastText(b.accent_color),
    "--radius": corners[b.corners].radius,
    fontFamily: fonts[b.font].css,
  } as CSSProperties;
}

/** Contraste da cor da marca contra a superfície do tema (para avisar o admin). */
export function brandContrastOnTheme(brand: string, theme: Theme) {
  return contrastRatio(brand, theme === "dark" ? "#151517" : "#ffffff");
}
