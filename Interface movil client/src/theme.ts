/** Paleta y constantes de diseño, espejo del web client (Tailwind -> RN). */
export const colors = {
  foreground: "#1A1A2E", // texto principal
  accent: "#FFF200", // amarillo MercAldas
  muted: "#6B7280", // texto secundario
  border: "#E5E7EB",
  background: "#FFFFFF",
  surface: "#F4F4F6", // gris claro para cajas
  danger: "#FF4444",
  success: "#16A34A",
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
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
