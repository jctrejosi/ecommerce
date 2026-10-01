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
  /** Foto de perfil (Cloudinary); null si no tiene. */
  avatarUrl?: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user: AuthMe;
}

/** Mensaje del hilo único de chat entre el picker y administración. */
export interface PickerChatMessage {
  id: number;
  senderType: "picker" | "admin";
  senderUserId: number | null;
  body: string;
  createdAt: string | null;
  readAt: string | null;
}

/** No leídos del hilo + último mensaje (alimenta el badge del header). */
export interface PickerChatSummary {
  unread: number;
  lastMessage: PickerChatMessage | null;
}

/** Pedido del historial del picker (ya cerrado en caja). */
export interface PickingHistoryOrder {
  id: number;
  referenceCode: string;
  customerName: string;
  status: string;
  grandTotal: number;
  createdAt: string;
  pickedAt: string | null;
  completedAt: string | null;
  itemsCount: number;
  totalPieces: number;
}

/** Página del historial del picker (lazy load de 10). */
export interface PickingHistoryResponse {
  orders: PickingHistoryOrder[];
  total: number;
  hasMore: boolean;
}

/** Status que acepta `GET /picking/orders?status=`. */
export type QueueFilter = "nuevo" | "preparando" | "completado";

export const QUEUE_FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "nuevo", label: "Nuevos" },
  { key: "preparando", label: "Preparando" },
  { key: "completado", label: "Completados" },
];
