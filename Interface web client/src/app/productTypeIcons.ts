// Íconos (emojis) de los tipos de producto, relacionados con su nombre.
// Se referencian por el código del tipo (estable) y hay fallback por índice.
//
// Son solo el RESPALDO: si el tipo tiene imagen cargada desde el admin
// (`imagePath` en /catalog/product-types y /landing/product-types), esa imagen
// manda. El emoji se usa cuando el tipo no tiene imagen.
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
