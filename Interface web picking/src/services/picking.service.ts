// Servicio API del picking — habla con el backend Nest (mercaldas-ecommerce/backend)
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

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

/** Estantería tal como la guarda el admin de picking (para el mapa). */
export interface PickingShelf {
  id: number;
  branchId: number;
  code: string;
  name: string;
  type: 'wall' | 'center';
  color: string;
  width: number;
  height: number;
  posX: number;
  posY: number;
  rotation: 0 | 90;
  productCount: number;
  rows: { id: number; rowNumber: number; label: string }[];
}

/** Ubicación de una variante en una sucursal. */
export interface PickingLocation {
  productVariantId: number;
  shelfId: number;
  rowNumber: number;
  shelfCode: string;
  shelfName: string;
  shelfColor: string;
}

export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload: any) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${input}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let payload: any = null;
    let message = `Error ${res.status}`;
    try {
      payload = await res.json();
      if (typeof payload?.message === "string") message = payload.message;
      else if (Array.isArray(payload?.message)) message = payload.message.join(", ");
    } catch {
      /* noop */
    }
    throw new ApiError(message, res.status, payload);
  }
  return res.json();
}

export const pickingService = {
  login: (identifier: string, password: string) =>
    fetchJson<{ user: unknown }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),

  queue: (status?: string) =>
    fetchJson<PickingOrder[]>(`/picking/orders${status ? `?status=${status}` : ""}`),

  unreviewedCount: () => fetchJson<{ count: number }>("/picking/orders/unreviewed-count"),

  detail: (id: number) => fetchJson<PickingOrder>(`/picking/orders/${id}`),

  markReviewed: (id: number) =>
    fetchJson<{ reviewed: boolean }>(`/picking/orders/${id}/reviewed`, { method: "POST" }),

  scan: (id: number, code: string) =>
    fetchJson<ScanResult>(`/picking/orders/${id}/scan`, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  complete: (id: number) =>
    fetchJson<{ ok: boolean; status: string }>(`/picking/orders/${id}/complete`, { method: "POST" }),

  shelves: (branchId: number) =>
    fetchJson<PickingShelf[]>(`/picking-admin/shelves?branchId=${branchId}`),

  locations: (branchId: number, variantIds: number[]) =>
    fetchJson<PickingLocation[]>(
      `/picking-admin/locations?branchId=${branchId}&variantIds=${variantIds.join(",")}`,
    ),

  pickers: () => fetchJson<{ id: number; name: string }[]>("/picking-admin/pickers"),

  claim: (id: number, pickerId: number) =>
    fetchJson<{ success: boolean; pickerId: number }>(`/picking/orders/${id}/claim`, {
      method: "POST",
      body: JSON.stringify({ pickerId }),
    }),
};
