// Tipos del admin de picking (espejo de backend/src/modules/shelves)

export interface Branch {
  id: number;
  code: string;
  name: string;
  city: string;
}

export interface ShelfRow {
  id: number;
  rowNumber: number;
  label: string;
}

export type ShelfType = 'wall' | 'center';

export interface Shelf {
  id: number;
  branchId: number;
  code: string;
  name: string;
  type: ShelfType;
  color: string;
  width: number;
  height: number;
  posX: number;
  posY: number;
  rotation: 0 | 90;
  categoryId: number | null;
  categoryName: string | null;
  productCount: number;
  rows: ShelfRow[];
}

/** Categoría del catálogo (para asociar estanterías). */
export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  level: number;
  productCount: number;
}

/** Estantería dentro de la organización de una categoría. */
export interface CategoryOrgShelf {
  id: number;
  branchId: number;
  code: string;
  name: string;
  color: string;
  productCount: number;
  rows: { rowNumber: number; label: string }[];
}

/** Producto de una categoría con su ubicación. */
export interface CategoryOrgProduct {
  productVariantId: number;
  productId: number;
  productName: string;
  sku: string | null;
  barcode: string | null;
  stock: number;
  shelfId: number | null;
  rowNumber: number | null;
  shelfCode: string | null;
  shelfName: string | null;
}

export interface CategoryOrganization {
  category: { id: number; name: string; level: number; parentId: number | null };
  shelves: CategoryOrgShelf[];
  products: CategoryOrgProduct[];
}

export interface ProductWithLocation {
  productVariantId: number;
  productId: number;
  productName: string;
  sku: string | null;
  barcode: string | null;
  stock: number;
  shelfId: number | null;
  rowNumber: number | null;
  shelfCode: string | null;
  shelfName: string | null;
}

export interface BulkAssignResult {
  assigned: number;
  total: number;
}

// ── Métricas de pickers ──

export interface PickerSummary {
  id: number;
  name: string;
  email: string;
  username: string;
  phone: string | null;
  /** Foto de perfil que sube el picker desde la app móvil (Cloudinary). */
  avatarUrl: string | null;
  currentOrder: {
    id: number;
    referenceCode: string;
    customerName: string;
    status: string;
    pickedAt: string | null;
    itemsCount: number;
    totalPieces: number;
    scannedPieces: number;
    remainingPieces: number;
    remainingItems: number;
  } | null;
  completedToday: number;
  dispatchedTotal: number;
}

export interface PickerHistoryOrder {
  id: number;
  referenceCode: string;
  customerName: string;
  grandTotal: number;
  status: string;
  pickedAt: string | null;
  completedAt: string | null;
  /** Entrega real al cliente (la marca el repartidor); null si aún no se entregó. */
  deliveredAt: string | null;
  itemsCount: number;
  totalPieces: number;
  scannedPieces: number;
}

export interface PickerHistory {
  picker: { id: number; name: string };
  orders: PickerHistoryOrder[];
}

// ── Detalle de pedido (con picker y productos) ──

export interface PickingOrderDetailItem {
  id: number;
  productVariantId: number | null;
  name: string;
  sku: string | null;
  quantity: number;
  pickedQty: number;
  barcode: string | null;
  plu: string | null;
  unitPriceGross: number;
  total: number;
}

export interface PickingOrderDetail {
  id: number;
  referenceCode: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  grandTotal: number;
  notes: string | null;
  reviewed: boolean;
  createdAt: string;
  branchId: number;
  pickerId: number | null;
  pickerName: string | null;
  itemsCount: number;
  totalPieces: number;
  scannedPieces: number;
  items: PickingOrderDetailItem[];
}

// ── Pedidos del panel (tab "Pedidos") ──

/** Pedido con su avance de alistamiento, para la vista administrativa. */
export interface PickingAdminOrder {
  id: number;
  referenceCode: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  grandTotal: number;
  createdAt: string;
  pickerId: number | null;
  pickerName: string | null;
  pickedAt: string | null;
  completedAt: string | null;
  /** Entrega real al cliente (la marca el repartidor); null si aún no se entregó. */
  deliveredAt: string | null;
  itemsCount: number;
  totalPieces: number;
  scannedPieces: number;
  remainingPieces: number;
  remainingItems: number;
}

export interface PickingAdminOrdersResponse {
  /** Sucursal filtrada; null cuando se listan todas. */
  branchId: number | null;
  /** Total de pedidos que cumplen el filtro de estado actual. */
  total: number;
  /** Conteo por estado del universo actual (sucursal + búsqueda). */
  counts: Record<string, number>;
  limit: number;
  offset: number;
  orders: PickingAdminOrder[];
}

// ── Chat administrador ↔ picker ──

export interface PickerChatMessage {
  id: number;
  senderType: 'picker' | 'admin';
  senderUserId: number | null;
  body: string;
  createdAt: string | null;
  readAt: string | null;
}

/** Renglón de la bandeja: un picker con su último mensaje y no leídos. */
export interface PickerChatConversation {
  pickerId: number;
  fullName: string;
  email: string;
  isActive: boolean;
  unread: number;
  lastMessage: { body: string; senderType: 'picker' | 'admin'; createdAt: string | null } | null;
}
