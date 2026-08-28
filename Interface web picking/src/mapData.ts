export const CELL = 36; // px per grid cell
export const SHELF_COLS = 3; // shelf width in cells
export const SHELF_ROW_H = 32; // px per shelf row band
export const SHELF_CODE_H = 20; // px for code header
export const CANVAS_W = 420;
export const CANVAS_H = 1020;

export interface ShelfRowDef {
  label: string;
}

export interface ShelfDef {
  id: string;
  code: string;
  name: string;
  type: "wall" | "center";
  rows: ShelfRowDef[];
  color: string;
}

export interface PlacedShelf extends ShelfDef {
  gridX: number;
  gridY: number;
  rotation: 0 | 90;
}

export function shelfPixelH(shelf: { rows: ShelfRowDef[] }) {
  return SHELF_CODE_H + shelf.rows.length * SHELF_ROW_H;
}

export function shelfPixelW(shelf: PlacedShelf) {
  return shelf.rotation === 90
    ? shelfPixelH(shelf)
    : SHELF_COLS * CELL;
}

export const INITIAL_PLACED: PlacedShelf[] = [
  {
    id: "ps-a1", code: "A1", name: "Lácteos", type: "wall", color: "#3B82F6",
    rows: [
      { label: "Leche y bebidas lácteas" },
      { label: "Quesos frescos" },
      { label: "Mantequilla / crema" },
      { label: "Yogurt bebible" },
      { label: "Kumis y avena" },
    ],
    gridX: 0, gridY: 1, rotation: 0,
  },
  {
    id: "ps-a2", code: "A2", name: "Bebidas", type: "wall", color: "#A855F7",
    rows: [
      { label: "Jugos naturales" },
      { label: "Jugos industriales" },
      { label: "Gaseosas" },
      { label: "Energéticas" },
      { label: "Aguas aromáticas" },
    ],
    gridX: 4, gridY: 1, rotation: 0,
  },
  {
    id: "ps-a3", code: "A3", name: "Panadería", type: "wall", color: "#F97316",
    rows: [
      { label: "Pan tajado" },
      { label: "Pan artesanal" },
      { label: "Galletas" },
      { label: "Ponqués" },
      { label: "Tostadas / snacks" },
    ],
    gridX: 8, gridY: 1, rotation: 0,
  },
  {
    id: "ps-b1", code: "B1", name: "Cereales", type: "center", color: "#EC4899",
    rows: [
      { label: "Arroz blanco / integral" },
      { label: "Cereales desayuno" },
      { label: "Avena" },
      { label: "Quinua / otros" },
    ],
    gridX: 0, gridY: 8, rotation: 0,
  },
  {
    id: "ps-b2", code: "B2", name: "Granos", type: "center", color: "#EAB308",
    rows: [
      { label: "Fríjoles" },
      { label: "Lentejas" },
      { label: "Arveja / garbanzo" },
      { label: "Maíz / otros" },
    ],
    gridX: 4, gridY: 8, rotation: 0,
  },
  {
    id: "ps-b3", code: "B3", name: "Conservas", type: "center", color: "#F59E0B",
    rows: [
      { label: "Atún / sardinas" },
      { label: "Verduras enlatadas" },
      { label: "Salsas / condimentos" },
      { label: "Aceites / vinagres" },
    ],
    gridX: 8, gridY: 8, rotation: 0,
  },
  {
    id: "ps-c1", code: "C1", name: "Abarrotes", type: "center", color: "#6B7280",
    rows: [
      { label: "Café y chocolate" },
      { label: "Azúcar y panela" },
      { label: "Harinas" },
      { label: "Especias" },
    ],
    gridX: 0, gridY: 14, rotation: 0,
  },
  {
    id: "ps-c2", code: "C2", name: "Aceites", type: "center", color: "#F97316",
    rows: [
      { label: "Aceite girasol" },
      { label: "Aceite de oliva" },
      { label: "Manteca" },
      { label: "Margarina" },
    ],
    gridX: 4, gridY: 14, rotation: 0,
  },
  {
    id: "ps-e1", code: "E1", name: "Aguas / Tés", type: "center", color: "#0EA5E9",
    rows: [
      { label: "Agua cristal 600ml" },
      { label: "Agua con gas" },
      { label: "Agua saborizada" },
      { label: "Tés y limonadas" },
    ],
    gridX: 8, gridY: 14, rotation: 0,
  },
  {
    id: "ps-d1", code: "D1", name: "Limpieza", type: "wall", color: "#06B6D4",
    rows: [
      { label: "Detergentes" },
      { label: "Jabones corporales" },
      { label: "Limpiapisos" },
      { label: "Papel higiénico" },
      { label: "Servilletas / toallas" },
    ],
    gridX: 0, gridY: 20, rotation: 0,
  },
  {
    id: "ps-d3", code: "D3", name: "Cuidado personal", type: "center", color: "#A855F7",
    rows: [
      { label: "Shampoo / acond." },
      { label: "Cremas / lociones" },
      { label: "Desodorantes" },
      { label: "Cepillos / pasta dental" },
    ],
    gridX: 4, gridY: 20, rotation: 0,
  },
  {
    id: "ps-a4", code: "A4", name: "Verduras y frutas", type: "wall", color: "#22C55E",
    rows: [
      { label: "Tomates" },
      { label: "Papas y tubérculos" },
      { label: "Cebollas / ajos" },
      { label: "Lechugas / verduras" },
      { label: "Frutas" },
    ],
    gridX: 8, gridY: 20, rotation: 0,
  },
];

export const INITIAL_AVAILABLE: ShelfDef[] = [
  {
    id: "sd-f1", code: "F1", name: "Carnes frías", type: "center", color: "#EF4444",
    rows: [
      { label: "Pollo" },
      { label: "Res" },
      { label: "Cerdo" },
      { label: "Embutidos" },
    ],
  },
  {
    id: "sd-g1", code: "G1", name: "Congelados", type: "wall", color: "#0EA5E9",
    rows: [
      { label: "Helados" },
      { label: "Listos congelados" },
      { label: "Papas congeladas" },
      { label: "Mariscos" },
      { label: "Verduras congeladas" },
    ],
  },
];
