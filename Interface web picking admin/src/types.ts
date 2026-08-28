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
  posX: number;
  posY: number;
  rotation: 0 | 90;
  productCount: number;
  rows: ShelfRow[];
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
  currentOrder: {
    id: number;
    referenceCode: string;
    customerName: string;
    status: string;
    pickedAt: string | null;
    itemsCount: number;
    totalPieces: number;
    scannedPieces: number;
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
  deliveredAt: string;
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
