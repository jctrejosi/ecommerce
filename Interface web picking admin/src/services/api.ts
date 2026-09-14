// Cliente API del admin de picking — habla con el backend Nest (:3000)
import type {
  Branch,
  BulkAssignResult,
  Category,
  CategoryOrganization,
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

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  fullName: string;
  isSuperuser: boolean;
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user: AuthUser;
}

/** Usuario de picking tal como lo devuelve el panel. */
export interface PickUser {
  id: number;
  name: string;
  email: string;
  username: string;
  phone: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  /** Si puede iniciar sesión en la app móvil de picking. */
  isPicker: boolean;
}

export interface CreatePickUserPayload {
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
}

export interface ShelfPayload {
  branchId: number;
  code: string;
  name: string;
  type: ShelfType;
  color: string;
  width?: number;
  height?: number;
  posX: number;
  posY: number;
  rotation: 0 | 90;
  categoryId: number | null;
  rows: { rowNumber: number; label: string }[];
}

export const api = {
  branches: () => fetchJson<Branch[]>('/picking-admin/branches'),

  categories: () => fetchJson<Category[]>('/picking-admin/categories'),

  categoryOrganization: (categoryId: number, branchId: number) =>
    fetchJson<CategoryOrganization>(
      `/picking-admin/categories/${categoryId}/organization?branchId=${branchId}`,
    ),

  schedule: (branchId: number) =>
    fetchJson<{ branchId: number; schedule: Record<string, string> }>(
      `/picking-admin/branches/${branchId}/schedule`,
    ),

  saveSchedule: (branchId: number, schedule: Record<string, string>) =>
    fetchJson<{ branchId: number; schedule: Record<string, string> }>(
      `/picking-admin/branches/${branchId}/schedule`,
      { method: 'PUT', body: JSON.stringify({ schedule }) },
    ),

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

  // ─── Sesión ────────────────────────────────────────────────────────────────
  me: () => fetchJson<AuthUser>('/auth/me'),

  login: (identifier: string, password: string) =>
    fetchJson<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  logout: () =>
    fetchJson<{ success: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // ─── Usuarios de picking ───────────────────────────────────────────────────
  users: () => fetchJson<PickUser[]>('/picking-admin/users'),

  createUser: (payload: CreatePickUserPayload) =>
    fetchJson<PickUser>('/picking-admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateUser: (
    id: number,
    payload: Partial<Omit<CreatePickUserPayload, 'password'>> & {
      isActive?: boolean;
      isPicker?: boolean;
    },
  ) =>
    fetchJson<PickUser>(`/picking-admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  resetUserPassword: (id: number, password: string) =>
    fetchJson<{ success: boolean }>(`/picking-admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
};

export type { ShelfRow };
