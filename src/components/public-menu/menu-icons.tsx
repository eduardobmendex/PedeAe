import type { SVGProps } from "react";

// Ícones de traço do cardápio público. Usam currentColor: a cor vem do tema ativo.

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon strokeWidth={2.6} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CrownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z" fill="currentColor" />
  </Icon>
);

export const FlameIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1 2.6 2 3.1C11 9 11 6 12 3Z" />
  </Icon>
);

export const ChefHatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 14.5A4 4 0 0 1 6.2 6.6a5 5 0 0 1 9.6-1.4 4 4 0 0 1 1.2 7.9V20H7Z" />
    <path d="M7 17h10" />
  </Icon>
);

const BurgerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10a8 5 0 0 1 16 0Z" />
    <path d="M3.5 13.5h17M5 17h14a1 1 0 0 1-1 2.5H6A1 1 0 0 1 5 17Z" />
  </Icon>
);

const PizzaIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6.5a20 20 0 0 1 17 0L12 21Z" />
    <path d="M5 9.2a17 17 0 0 1 14 0" />
    <circle cx="10" cy="12" r="1" />
    <circle cx="13.5" cy="14.5" r="1" />
  </Icon>
);

const FriesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 10 7 4m3.5 6L10 3m3.5 7L14 3m2.5 7L17 4.5" />
    <path d="M5 10h14l-2 11H7Z" />
  </Icon>
);

const CupIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 7h12l-1.5 14h-9Z" />
    <path d="m12 7 2-4h3M6.5 11.5h11" />
  </Icon>
);

const BeerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 8h10v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z" />
    <path d="M15 11h2.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M5 8a2.5 2.5 0 0 1 2.5-4.5A3 3 0 0 1 13 4a2.5 2.5 0 0 1 2 4M8.5 12v5.5m3-5.5v5.5" />
  </Icon>
);

const SkewerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 21 18-18" />
    <rect x="6.5" y="11.5" width="5" height="4" rx="1.5" transform="rotate(-45 9 13.5)" />
    <rect x="11.5" y="6.5" width="5" height="4" rx="1.5" transform="rotate(-45 14 8.5)" />
  </Icon>
);

const PlateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 15h18M4.5 15a7.5 7.5 0 0 1 15 0" />
    <path d="M12 6V4.5M4 19h16" />
  </Icon>
);

const IceCreamIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 11 12 21l4.5-10" />
    <path d="M7 11a5 5 0 1 1 10 0Z" />
  </Icon>
);

const UtensilsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3v7a2 2 0 0 0 4 0V3M8 3v18" />
    <path d="M17 21V3c-2 1.5-3 4-3 7h3" />
  </Icon>
);

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// A ordem importa: "Porções de batata" cai em porções antes de qualquer outra regra.
const CATEGORY_ICONS: [RegExp, (p: IconProps) => React.JSX.Element][] = [
  [/pizza/, PizzaIcon],
  [/hamb|burger|lanche|sandu|x-/, BurgerIcon],
  [/porc|petisc|batata|frit|salgad|pastel|tira-gosto/, FriesIcon],
  [/cervej|chopp|beer/, BeerIcon],
  [/espet|churras/, SkewerIcon],
  [/sobremes|doce|acai|sorvet|bolo/, IceCreamIcon],
  [/bebid|refri|suco|drink|agua|vinho|caipi|dose|cafe/, CupIcon],
  [/prato|baian|refei|executiv|moquec|caldo|almoc|jantar|peixe|carne|massa/, PlateIcon],
];

/** Ícone da categoria pelo nome; categorias sem correspondência usam talheres. */
export function CategoryIcon({ name, ...props }: IconProps & { name: string }) {
  const n = normalize(name);
  const Match = CATEGORY_ICONS.find(([re]) => re.test(n))?.[1] ?? UtensilsIcon;
  return <Match {...props} />;
}
