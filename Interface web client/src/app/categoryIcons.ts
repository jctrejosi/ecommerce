// Íconos (emojis) de las categorías del catálogo, elegidos uno por uno según el
// nombre de cada categoría. Se referencian por `slug`, que es estable y es lo
// que devuelve `/catalog/categories`.
//
// Para categorías nuevas que no estén en el mapa hay un respaldo por palabras
// clave (`CATEGORY_KEYWORDS`) y, si nada coincide, un ícono genérico.
export const CATEGORY_ICONS: Record<string, string> = {
  // ── Raíz ────────────────────────────────────────────────────────────────
  "carnes-frias-embutidos-y-delicatessen": "🥓",
  electrodomesticos: "🔌",

  // ── Nivel 1 ─────────────────────────────────────────────────────────────
  "carnes-pollo-y-pescado-02": "🥩",
  "cuidado-del-bebe-08": "👶",
  "despensa-05": "🥫",
  "frutas-y-verduras-04": "🥬",
  "lacteos-y-refrigerados-06": "🥛",
  "limpieza-10": "🧹",
  "mascotas-09": "🐾",
  "vinos-y-licores-07": "🍸",

  // ── Despensa ────────────────────────────────────────────────────────────
  "aceite-0502": "🫒",
  "arroz-granos-0501": "🍚",
  "arroz-050101": "🍚",
  "granos-050102": "🌾",
  "azucar-panelas-endulzantes-0508": "🍯",
  "azucar-050801": "🍬",
  "panales-050802": "👶",
  "ebdulzantes-sustitutos-050803": "🍬",
  "cafe-chocolate-infusiones-0509": "☕",
  "cafe-instantaneo-050901": "☕",
  "cafe-molido-050902": "☕",
  "cafe-en-grano-050903": "☕",
  "cafes-especiales-adiciones-050904": "☕",
  "chocolates-de-mesa-050905": "🍫",
  "cocoas-de-mesa-050906": "🍫",
  "aromaticas-050907": "🌿",
  "te-050908": "🍵",
  "leches-en-polvo-0510": "🥛",
  "leches-enteras-051001": "🥛",
  "leches-descremadas-deslactosadas-051002": "🥛",
  "pastas-fideos-pures-0505": "🍝",
  "spagueti-050501": "🍝",
  "pastas-050502": "🍝",
  "preparaciones-instantaneas-050403": "🥣",
  "sopas-cremas-bases-0504": "🍲",
  "sopas-cremas-050401": "🍲",
  "bases-050402": "🥣",
  "sal-caldos-condimentos-0503": "🧂",
  "sal-050301": "🧂",
  "caldos-050302": "🍲",
  "condimentos-050303": "🧂",
  "salsas-aderezos-vinagres-0506": "🥗",
  "salsas-para-cocina-mesa-050601": "🥫",
  "aderezos-050602": "🥗",
  "vinagres-050603": "🍶",
  "enlatados-conservas-0507": "🥫",
  "pescado-en-conserva-050701": "🐟",
  "vegetales-en-conserva-050702": "🥫",
  "frutas-en-conserva-050703": "🍑",
  "encurtidos-en-conservas-050704": "🥒",
  "carnes-en-conserva-050705": "🥫",

  // ── Frutas y verduras ───────────────────────────────────────────────────
  "frutas-0401": "🍎",
  "guayabas-tomates-de-arbol-040101": "🍐",
  "bananos-040102": "🍌",
  "guanabana-coco-040103": "🥥",
  "mandarinas-naranjas-040104": "🍊",
  "lulos-kiwi-maracuyas-040105": "🥝",
  "melones-papayas-sandias-040106": "🍉",
  "manzanas-peras-mangos-040107": "🍎",
  "pi-as-pitayas-granadillas-040108": "🍍",
  "uvas-uchuvas-moras-fresas-040109": "🍇",
  "verduras-0402": "🥦",
  "aguacates-mazorcas-040201": "🥑",
  "cebollas-ajos-040202": "🧅",
  "champi-ones-raices-040203": "🍄",
  "cilantros-guascas-perejiles-040204": "🌿",
  "coliflor-apios-brocolis-040205": "🥦",
  "habichuelas-granos-desgranados-040206": "🫘",
  "lechugas-repollos-espinacas-040207": "🥬",
  "limones-040208": "🍋",
  "platanos-guineos-040209": "🍌",
  "papas-yucas-arracachas-040210": "🥔",

  // ── Carnes, pollo y pescado ─────────────────────────────────────────────
  "carnes-de-res-0201": "🐄",
  "anca-020101": "🥩",
  "cadera-020102": "🥩",
  "carne-molida-020103": "🍖",
  "falda-especial-020104": "🥩",
  "hamburguesa-020105": "🍔",
  "huevo-de-pierna-020106": "🥩",
  "lomo-020107": "🥩",
  "lomo-gourmet-020108": "🥩",
  "pierna-magra-020109": "🥩",
  "sobrebarriga-especial-020110": "🥩",
  "carne-de-cerdo-0202": "🐖",
  "cordon-de-cerdo-020201": "🥩",
  "cordon-gourmet-020202": "🥩",
  "costilla-020203": "🍖",
  "costilla-con-tocino-especial-020204": "🥓",
  "espinazo-020205": "🦴",
  "osobuco-020206": "🥩",
  "pernil-020207": "🍖",
  "tocino-especial-020208": "🥓",
  "pollo-0203": "🍗",
  "pollo-entero-020301": "🍗",
  "preparados-de-pollo-020302": "🍗",
  "cortes-de-pollo-menudencias-020303": "🍗",
  "pescados-mariscos-0204": "🐟",
  "pescados-enteros-020401": "🐟",
  "filetes-de-pescado-020402": "🐟",
  "mariscos-020403": "🦐",
  "carnes-frias-embutidos-0301": "🌭",
  "chorizos-030101": "🌭",
  "hamburguesas-carnes-adobadas-030102": "🍔",
  "jamones-jamonadas-030103": "🍖",
  "morcillas-rellenos-030104": "🍖",
  "mortadelas-tocinetas-productos-ahumados-030105": "🥓",
  "salchichas-salchichones-cabanos-030106": "🌭",

  // ── Lácteos y refrigerados ──────────────────────────────────────────────
  "leches-liquidas-0601": "🥛",
  "leches-deslactosadas-descremadas-060102": "🥛",
  "leches-larga-vida-060103": "🥛",
  "leches-saborizadas-060104": "🥛",

  // ── Vinos y licores ─────────────────────────────────────────────────────
  "vinos-0701": "🍷",
  "blanco-070101": "🥂",
  "tinto-070102": "🍷",
  "rosado-070103": "🍷",
  "vinos-espumosos-champa-a-070104": "🍾",
  "vinos-de-cocina-070105": "🍷",

  // ── Cuidado del bebé ────────────────────────────────────────────────────
  "alimentacion-0801": "🍼",
  "leches-infantiles-080101": "🍼",
  "cereales-coladas-080102": "🥣",
  "compotas-080103": "🍎",
  "yogures-postres-080104": "🍨",

  // ── Mascotas ────────────────────────────────────────────────────────────
  "gatos-0901": "🐱",
  "alimentos-para-gatos-090101": "🐟",
  "higuiene-para-gatos-090102": "🧴",
  "accesorios-para-gatos-090103": "🧶",

  // ── Limpieza ────────────────────────────────────────────────────────────
  "limpieza-de-cocina-1001": "🧽",
  "esponjas-fibras-100101": "🧽",
  "lavalozas-brilla-ollas-100102": "🧼",
  "limpiadores-desengrasantes-100103": "🧴",
  "toallas-de-cocina-100104": "🧻",

  // ── Electrodomésticos ───────────────────────────────────────────────────
  "lavadoras-secadoras-0101": "🧺",
  "lavadora-secadora-010101": "🧺",
  "lavadoras-010102": "🧺",
  "secadoras-010103": "🧺",
  "refrigeracion-0102": "🧊",
  "minibares-010201": "🧊",
  "nevecones-010202": "🧊",
  "neveras-010203": "🧊",
  "congeladores-010204": "🧊",
  "dospensadores-de-agua-010205": "🚰",
  "peque-os-electrodomesticos-0103": "🍳",
  "campanas-010301": "💨",
  "cubiertas-010302": "🍽️",
  "estufas-010303": "🍳",
  "cafeteras-010304": "☕",
  "exprimidores-picatodo-010305": "🍹",
  "hornos-microondas-empotrables-010306": "🔥",
  "hornos-tostadores-010307": "🍞",
  "licuadoras-010308": "🥤",
  "ollas-arroceras-010309": "🍲",
  "procesadores-de-alimentos-010310": "🥣",
  "cuidado-personal-0104": "💄",
  "afeitadoras-010401": "🪒",
  "planchas-para-cabello-010402": "💇",
  "rizadores-010403": "💇",
  "secadores-para-cabello-010404": "💇",
  "toallas-para-manos-y-cuerpo-010405": "🛁",
  "equipos-de-gimnasia-010406": "🏋️",
  "climatizacion-0105": "❄️",
  "aires-acondicionados-010501": "❄️",
  "calentadores-010502": "♨️",
  "ventiladores-010503": "🌀",
  "cuidado-de-prendas-0106": "🧵",
  "maquinas-de-coser-010601": "🧵",
  "planchas-para-prendas-010602": "👕",
  "maquinas-fileteadoras-010603": "🔪",

  // ── Aceites ─────────────────────────────────────────────────────────────
  "aceites-de-oliva-050201": "🫒",
  "aceites-de-girasol-vegetal-050202": "🌻",
  "aceites-especiales-050203": "🫒",
};

/** Ícono por defecto cuando el nombre no coincide con ninguna palabra clave. */
export const CATEGORY_FALLBACK_ICON = "🛒";

/**
 * Palabras clave (sobre el nombre normalizado) para que una categoría nueva
 * tenga un ícono coherente sin tocar este archivo.
 */
const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/carne|res|cerdo|pollo|pescado|marisco|embutido|jamon|chorizo|salchicha/, "🥩"],
  [/fruta|banano|naranja|manzana|uva|melon/, "🍎"],
  [/verdura|vegetal|hortaliza|lechuga|cebolla|papa/, "🥬"],
  [/leche|lacteo|yogur|queso|kumis/, "🥛"],
  [/arroz|grano|pasta|fideo|spagueti/, "🍚"],
  [/pan|arepa|galleta|tostad/, "🍞"],
  [/cafe|chocolate|cocoa|te|aromatica|infusion/, "☕"],
  [/azucar|panel|endulz|dulce|postre|helado/, "🍬"],
  [/aceite|oliva/, "🫒"],
  [/salsa|aderezo|vinagre|condimento|caldo|sal/, "🧂"],
  [/conserva|enlatado|encurtido/, "🥫"],
  [/limpieza|limpiador|jabon|detergente|esponja|blanqueador/, "🧹"],
  [/electro|nevera|lavadora|secadora|licuadora|ventilador|aire|estufa/, "🔌"],
  [/bebe|infantil|panal|compota/, "👶"],
  [/mascota|gato|perro/, "🐾"],
  [/vino|licor|cerveza|aguardiente|whisky/, "🍷"],
  [/cuidado personal|belleza|cabello|afeit|maquillaje/, "💄"],
  [/hogar|cosina|cocina|olla|sarten/, "🏠"],
];

/** Normaliza a minúsculas y sin acentos para comparar contra las palabras clave. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Ícono de una categoría: por `slug` exacto, luego por nombre y al final genérico. */
export function categoryIcon(
  slug: string | null | undefined,
  name?: string | null,
): string {
  if (slug && CATEGORY_ICONS[slug]) return CATEGORY_ICONS[slug];
  const haystack = normalize(name || slug || "");
  for (const [pattern, icon] of CATEGORY_KEYWORDS) {
    if (pattern.test(haystack)) return icon;
  }
  return CATEGORY_FALLBACK_ICON;
}
