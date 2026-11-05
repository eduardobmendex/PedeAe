// Registro das identidades visuais: ÚNICA fonte das cores da aplicação.
// Para criar uma identidade, adicione um item em `identities`. O CSS, o seletor,
// a persistência e os testes de contraste derivam daqui, sem tocar em componentes.
// (O banco também lista os ids aceitos: organization_settings_theme_check.)

export type IdentityTokens = {
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  /** Fundo de botões e elementos ativos. */
  primary: string;
  primaryContrast: string;
  /** Primária usada como TEXTO sobre fundos do tema (pode precisar de mais contraste). */
  primaryText: string;
  secondary: string;
  secondaryContrast: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  shadow: string;
};

export type Identity = { name: string; tagline: string; description: string; tokens: IdentityTokens };

export const identities = {
  dark: {
    name: "DARK",
    tagline: "Black & Gold",
    description: "Preto e dourado. Premium, sofisticado e marcante.",
    tokens: {
      scheme: "dark",
      bg: "#080808",
      surface: "#0f0b0b",
      surface2: "#0a0707",
      border: "#292929",
      borderStrong: "#3D3D3D",
      text: "#FFFFFF",
      muted: "#A3A3A3",
      primary: "#FFB800",
      primaryContrast: "#000000",
      primaryText: "#FFB800",
      secondary: "#F5A900",
      secondaryContrast: "#000000",
      danger: "#F2685F",
      dangerSoft: "#3A1513",
      success: "#4CC77A",
      successSoft: "#11291A",
      warning: "#FFB800",
      warningSoft: "#332608",
      info: "#6AA1F5",
      infoSoft: "#132239",
      shadow: "0 1px 2px rgb(0 0 0 / 0.6), 0 8px 24px rgb(0 0 0 / 0.35)",
    },
  },
  red: {
    name: "RED",
    tagline: "Red Passion",
    description: "Vermelho e preto. Ousado, energético e gastronômico.",
    tokens: {
      scheme: "dark",
      bg: "#171313",
      surface: "#100d0dff",
      surface2: "#100d0dff",
      border: "#382929",
      borderStrong: "#4F3A3A",
      text: "#FFFFFF",
      muted: "#BDB5B5",
      primary: "#E53935",
      primaryContrast: "#FFFFFF",
      primaryText: "#FF5252",
      secondary: "#FF5252",
      secondaryContrast: "#000000",
      danger: "#FF7B78",
      dangerSoft: "#451C1B",
      success: "#5BCF86",
      successSoft: "#14291C",
      warning: "#F5B041",
      warningSoft: "#37280F",
      info: "#7FB0F7",
      infoSoft: "#1B2537",
      shadow: "0 1px 2px rgb(0 0 0 / 0.5), 0 8px 24px rgb(40 0 0 / 0.35)",
    },
  },
  white: {
    name: "WHITE",
    tagline: "Clean & Fresh",
    description: "Claro e minimalista. Leve, elegante e muito legível.",
    tokens: {
      scheme: "light",
      bg: "#FFFFFF",
      surface: "#FFFFFF",
      surface2: "#F7F7F7",
      border: "#E8E8E8",
      borderStrong: "#CFCFCF",
      text: "#171717",
      muted: "#737373",
      primary: "#E99B00",
      primaryContrast: "#000000",
      primaryText: "#8F5F00",
      secondary: "#F5B52E",
      secondaryContrast: "#000000",
      danger: "#C2261D",
      dangerSoft: "#FDECEA",
      success: "#14753A",
      successSoft: "#E8F6ED",
      warning: "#8F5F00",
      warningSoft: "#FFF4DC",
      info: "#1D5FC2",
      infoSoft: "#E8F0FD",
      shadow: "0 1px 2px rgb(0 0 0 / 0.05), 0 4px 16px rgb(0 0 0 / 0.04)",
    },
  },
} as const satisfies Record<string, Identity>;

export type ThemeId = keyof typeof identities;
export const themeIds = Object.keys(identities) as ThemeId[];
export const DEFAULT_THEME: ThemeId = "white";

export const isThemeId = (value: unknown): value is ThemeId => typeof value === "string" && value in identities;

function tokensToCss(t: IdentityTokens) {
  return [
    `color-scheme:${t.scheme}`,
    `--bg:${t.bg}`,
    `--surface:${t.surface}`,
    `--surface-2:${t.surface2}`,
    `--border:${t.border}`,
    `--border-strong:${t.borderStrong}`,
    `--text:${t.text}`,
    `--muted:${t.muted}`,
    `--brand:${t.primary}`,
    `--brand-contrast:${t.primaryContrast}`,
    `--brand-text:${t.primaryText}`,
    `--accent:${t.secondary}`,
    `--accent-contrast:${t.secondaryContrast}`,
    `--danger:${t.danger}`,
    `--danger-soft:${t.dangerSoft}`,
    `--success:${t.success}`,
    `--success-soft:${t.successSoft}`,
    `--warning:${t.warning}`,
    `--warning-soft:${t.warningSoft}`,
    `--info:${t.info}`,
    `--info-soft:${t.infoSoft}`,
    `--shadow:${t.shadow}`,
  ].join(";");
}

/** CSS de todas as identidades; a página nasce com ele, então não há flash de tema. */
export const identitiesCss = themeIds
  .map((id) => {
    // :where() zera a prioridade do padrão: <html data-theme="dark"> precisa vencer o :root.
    const selector = id === DEFAULT_THEME ? `:where(:root),[data-theme="${id}"]` : `[data-theme="${id}"]`;
    return `${selector}{${tokensToCss(identities[id].tokens)}}`;
  })
  .join("\n");
