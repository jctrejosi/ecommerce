/**
 * Tokens de diseño espejo del web client.
 * Fuente de verdad: `Interface web client/src/styles/theme.css` (Tailwind v4).
 *
 * Reglas de conversión:
 * - rem → dp con base 16px.
 * - Radios Tailwind: rounded-lg 8, rounded-xl 12, rounded-2xl 16, rounded-3xl 24.
 * - Sombras Tailwind: shadow-sm / shadow-md / shadow-lg / shadow-xl.
 */
export const colors = {
  background: "#FFFFFF",
  foreground: "#1A1A2E",

  card: "#FFFFFF",
  cardForeground: "#1A1A2E",
  popover: "#FFFFFF",
  popoverForeground: "#1A1A2E",

  /** Amarillo Mercaldas (botones primarios, badges, dots activos). */
  primary: "#FFF200",
  primaryForeground: "#1A1A2E",

  /** Azul noche de la marca (secciones oscuras, textos alternos). */
  secondary: "#1A1A2E",
  secondaryForeground: "#FFFFFF",

  /** Gris claro de fondos/chips. */
  muted: "#F4F4F6",
  /** Gris de texto secundario. */
  mutedForeground: "#6B7280",

  /** Rojo de acento (badges de descuento, notificaciones). */
  accent: "#FF4444",
  accentForeground: "#FFFFFF",

  destructive: "#D4183D",
  destructiveForeground: "#FFFFFF",

  /** Borde por defecto del tema: rgba(0,0,0,0.08). */
  border: "rgba(0, 0, 0, 0.08)",
  input: "transparent",
  inputBackground: "#F4F4F6",
  switchBackground: "#cbced4",
  ring: "#FFF200",

  // ── Extras propios de la app (no están en el tema web) ──
  success: "#16A34A",
  footerBg: "#111827",
  white: "#FFFFFF",
} as const;

/** Radios del web (Tailwind). */
export const radii = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  twoXl: 16,
  threeXl: 24,
  full: 9999,
} as const;

/** Escala de espaciado (Tailwind: 1 = 4dp). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  twoXl: 32,
  threeXl: 40,
  fourXl: 56,
} as const;

/** Escala tipográfica del web (text-xs, text-sm, … en dp). */
export const text = {
  xxs: 10,
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  twoXl: 24,
  threeXl: 30,
  fourXl: 36,
} as const;

/**
 * Familias del web: Inter (sans) y Bricolage Grotesque (display, títulos
 * `font-black`). Se cargan con expo-font; hasta entonces cae al sistema.
 */
export const fonts = {
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemibold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  display: "BricolageGrotesque_400Regular",
  displaySemibold: "BricolageGrotesque_600SemiBold",
  displayBold: "BricolageGrotesque_700Bold",
  /** Equivalente a `font-black` (900) del web; la fuente llega hasta 800. */
  displayBlack: "BricolageGrotesque_800ExtraBold",
} as const;

/** Sombras equivalentes a shadow-sm / md / lg / xl de Tailwind. */
export const shadow = {
  sm: {
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  lg: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  xl: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
} as const;

/** Duraciones de las animaciones del web (ms). */
export const duration = {
  fast: 150,
  base: 300,
  heroFade: 450,
  slide: 500,
  carousel: 600,
  popup: 500,
  autoplayHero: 5000,
  autoplayCategories: 2500,
  autoplayAds: 6000,
  autoplayDeals: 8000,
} as const;

/** Alturas de layout compartidas. */
export const layout = {
  headerHeight: 64,
  heroHeight: 340,
  adBannerHeight: 160,
  maxWidth: 1280,
} as const;

/** Moneda COP, igual que el `fmt` del web client. */
export function fmtCOP(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Íconos (emojis) de los tipos de producto, igual que productTypeIcons.ts. */
export const PRODUCT_TYPE_ICONS: Record<string, string> = {
  CARNES: "🥩",
  BEBE: "👶",
  LACTEOS: "🥛",
  ELECTRO: "🔌",
  MASCOTAS: "🐾",
  FRUTAS: "🥬",
  LIMPIEZA: "🧹",
  DESPENSA: "🥫",
  TECNO: "💻",
  HOGAR: "🏠",
  VINOS: "🍷",
  CUIDADO: "💄",
};

const FALLBACK_ICONS = [
  "🥬",
  "🥩",
  "🥛",
  "🥫",
  "🧹",
  "💄",
  "👶",
  "🍷",
  "🏠",
  "💻",
  "🐾",
  "🔌",
];

export function productTypeIcon(code: string, index = 0): string {
  return (
    PRODUCT_TYPE_ICONS[code] ?? FALLBACK_ICONS[index % FALLBACK_ICONS.length]
  );
}
