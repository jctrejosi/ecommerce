// Íconos (emojis) de los tipos de producto, relacionados con su nombre.
// Se referencian por el código del tipo (estable) y, si no coincide, por
// palabras clave del nombre; hay fallback por índice.
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

// Respaldo por nombre: los tipos de TID traen códigos numéricos, así que el
// ícono se resuelve por palabras clave del nombre. El orden importa: lo más
// específico va primero (p. ej. "CUIDADO DEL BEBE" → 👶, no 💄).
const NAME_ICONS: Array<[RegExp, string]> = [
  [/BEB[EÉ]|INFANT|PA[ÑN]AL/i, "👶"],
  [/MASCOTA|PERRO|GATO/i, "🐾"],
  [/CARNE|POLLO|PESCADO|CERDO|EMBUTIDO|CHARCUTER/i, "🥩"],
  [/L[ÁA]CTEO|LECHE|QUESO|YOGUR/i, "🥛"],
  [/VERDURA|FRUTA|HORTALIZA|PULPA|FRUVER/i, "🥬"],
  [/LIMPIEZA|ASEO|DESINFEC|JAB[ÓO]N|DETERGENTE|LIMPIADOR/i, "🧹"],
  [/HOGAR|CASA|MUEBLE|UTENSILIO|MENAGE/i, "🏠"],
  [/CUIDADO|PERSONAL|COSMET|BELLEZA|HIGIENE|ORAL/i, "💄"],
  [/VINO|LICOR|CERVEZA|AGUARDIENTE|WHISKY|RON|COGNAC/i, "🍷"],
  [/TECNOLOG|ELECTR[ÓO]NIC|CELULAR|COMPUTO/i, "💻"],
  [/ELECTRODOM/i, "🔌"],
  [/DESPENSA|ABARROTE|ENLATAD|GRANO|PASTA|ARROZ|ACEITE|SAZONADOR|CONDIMENTO/i, "🥫"],
];

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

export function productTypeIcon(
  code: string,
  index = 0,
  name?: string,
): string {
  if (PRODUCT_TYPE_ICONS[code]) return PRODUCT_TYPE_ICONS[code];
  if (name) {
    for (const [re, icon] of NAME_ICONS) {
      if (re.test(name)) return icon;
    }
  }
  return FALLBACK_ICONS[index % FALLBACK_ICONS.length];
}
