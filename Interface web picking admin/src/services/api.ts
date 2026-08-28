// Cliente API del admin de picking — habla con el backend Nest (:3000)
import type {
  Branch,
  BulkAssignResult,
  PickerHistory,
  PickerSummary,
  PickingOrderDetail,
  ProductWithLocation,
  Shelf,
  ShelfRow,
  ShelfType,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export { API_BASE_URL };

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
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let payload: any = null;
    let message = `Error ${res.status}`;
    try {
      payload = await res.json();
      if (typeof payload?.message === 'string') message = payload.message;
      else if (Array.isArray(payload?.message)) message = payload.message.join(', ');
    } catch {
      /* noop */
    }
    throw new ApiError(message, res.status, payload);
  }
  return res.json();
}

export interface ShelfPayload {
  branchId: number;
  code: string;
  name: string;
  type: ShelfType;
  color: string;
  posX: number;
  posY: number;
  rotation: 0 | 90;
  rows: { rowNumber: number; label: string }[];
}

export const api = {
  branches: () => fetchJson<Branch[]>('/picking-admin/branches'),

  shelves: (branchId: number) =>
    fetchJson<Shelf[]>(`/picking-admin/shelves?branchId=${branchId}`),

  createShelf: (payload: ShelfPayload) =>
    fetchJson<Shelf>('/picking-admin/shelves', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateShelf: (id: number, payload: Partial<ShelfPayload>) =>
    fetchJson<Shelf>(`/picking-admin/shelves/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteShelf: (id: number) =>
    fetchJson<{ success: boolean }>(`/picking-admin/shelves/${id}`, {
      method: 'DELETE',
    }),

  products: (branchId: number, search?: string) =>
    fetchJson<ProductWithLocation[]>(
      `/picking-admin/products?branchId=${branchId}${search && search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`,
    ),

  setLocation: (productVariantId: number, branchId: number, shelfId: number, rowNumber: number) =>
    fetchJson<{ success: boolean }>('/picking-admin/products/locations', {
      method: 'POST',
      body: JSON.stringify({ productVariantId, branchId, shelfId, rowNumber }),
    }),

  removeLocation: (productVariantId: number, branchId: number) =>
    fetchJson<{ success: boolean }>(
      `/picking-admin/products/locations/${productVariantId}?branchId=${branchId}`,
      { method: 'DELETE' },
    ),

  bulkAssign: (branchId: number, shelfId: number, rowNumber: number, onlyUnassigned?: boolean) =>
    fetchJson<BulkAssignResult>('/picking-admin/products/locations/bulk-assign', {
      method: 'POST',
      body: JSON.stringify({ branchId, shelfId, rowNumber, onlyUnassigned }),
    }),

  metrics: () => fetchJson<PickerSummary[]>('/picking-admin/metrics'),

  pickerHistory: (id: number) =>
    fetchJson<PickerHistory>(`/picking-admin/pickers/${id}/history`),

  orderDetail: (id: number) => fetchJson<PickingOrderDetail>(`/picking/orders/${id}`),
};

export type { ShelfRow };
