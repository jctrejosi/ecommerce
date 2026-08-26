// Íconos (emojis) de los tipos de producto, relacionados con su nombre.
// Se referencian por el código del tipo (estable) y hay fallback por índice.
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
    PRODUCT_TYPE_ICONS[code] ??
    FALLBACK_ICONS[index % FALLBACK_ICONS.length]
  );
}
