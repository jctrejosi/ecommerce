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
