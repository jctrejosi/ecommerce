/** Tipos del backend de picking (mismos que la web de picking). */

export type OrderStatus = "nuevo" | "preparando" | "completado";

export interface PickingItem {
  id: number;
  productVariantId: number | null;
  name: string;
  sku: string | null;
  quantity: number;
  pickedQty: number;
  barcode: string | null;
  plu: string | null;
  image: string | null;
  shelfCode: string | null;
  shelfName: string | null;
  rowNumber: number | null;
  unitPriceGross: number;
  total: number;
}

export interface PickingOrder {
  id: number;
  referenceCode: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  grandTotal: number;
  reviewed: boolean;
  createdAt: string;
  branchId: number;
  /** Usuario (picker) que tiene/reclamó el pedido; útil para "Completados". */
  pickerId: number | null;
  itemsCount: number;
  totalPieces: number;
  scannedPieces: number;
  items?: PickingItem[];
}

export interface ScanResult {
  ok: boolean;
  itemId: number;
  name: string;
  pickedQty: number;
  quantity: number;
  remaining: number;
  allDone: boolean;
  orderStatus: string;
  expected: string[];
}

export interface PickingShelf {
  id: number;
  branchId: number;
  code: string;
  name: string;
  type: "wall" | "center";
  color: string;
  width: number;
  height: number;
  posX: number;
  posY: number;
  rotation: 0 | 90;
  categoryId?: number | null;
  categoryName?: string | null;
  productCount: number;
  rows: { id: number; rowNumber: number; label: string }[];
}

export interface PickingLocation {
  productVariantId: number;
  shelfId: number;
  rowNumber: number;
  shelfCode: string;
  shelfName: string;
  shelfColor: string;
}

export interface Picker {
  id: number;
  name: string;
  email?: string | null;
  username?: string | null;
  phone?: string | null;
}

/** Respuesta de `POST /auth/login` (usuario administrador/picker). */
export interface AuthMe {
  id: number;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  isSuperuser: boolean;
  isActive: boolean;
  phone?: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user: AuthMe;
}

/** Status que acepta `GET /picking/orders?status=`. */
export type QueueFilter = "nuevo" | "preparando" | "completado";

export const QUEUE_FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "nuevo", label: "Nuevos" },
  { key: "preparando", label: "Preparando" },
  { key: "completado", label: "Completados" },
];
