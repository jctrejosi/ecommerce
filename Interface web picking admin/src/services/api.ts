// Cliente API del admin de picking — habla con el backend Nest (:3000)
import type {
  Branch,
  CatalogProduct,
  Category,
  CategoryOrganization,
  PickerChatConversation,
  PickerChatMessage,
  PickerHistory,
  PickerSummary,
  PickingAdminOrdersResponse,
  PickingOrderDetail,
  Shelf,
  ShelfType,
} from '../types';

/**
 * Base del API.
 *
 * El panel se abre tanto en `localhost` como desde el celular con la IP del
 * equipo en la red local (la que imprime `dev.js`). Si la URL configurada
 * apunta a localhost y la página NO se sirvió desde localhost, se resuelve
 * contra el host que sirvió la página: si no, el navegador del celular
 * buscaría el backend en el propio celular.
 *
 * Ojo: `localhost` y `127.0.0.1` son sitios distintos para el navegador. Si la
 * página se sirvió desde uno y el API está configurado en el otro, la cookie de
 * sesión (de primera parte en el host del API) no se envía y todo lo
 * autenticado responde 401. Por eso también se alinea ese caso.
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1)$/;

function portOf(url: string, fallback: string): string {
  try {
    return new URL(url).port || fallback;
  } catch {
    return fallback;
  }
}

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL ?? '';
  const pageHost = window.location.hostname;
  const configuredHost = (() => {
    try {
      return new URL(configured).hostname;
    } catch {
      return '';
    }
  })();
  const configuredIsLoopback = LOOPBACK.test(configuredHost);
  const pageIsLoopback = LOOPBACK.test(pageHost);

  // API sin configurar, o apuntando a loopback mientras la página se sirvió
  // desde otro host (celular en la red local): se usa el host de la página.
  if (!configured || (configuredIsLoopback && !pageIsLoopback)) {
    return `${window.location.protocol}//${pageHost}:${portOf(configured, '3000')}`;
  }
  if (configuredIsLoopback && pageIsLoopback && configuredHost !== pageHost) {
    return `${window.location.protocol}//${pageHost}:${portOf(configured, '3000')}`;
  }
  return configured;
}

const API_BASE_URL = resolveApiBaseUrl();

/** Handler que se dispara cuando una petición responde 401 (sesión vencida). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export { API_BASE_URL };

/**
 * El logo de la tienda lo entrega el backend como URL absoluta (Cloudinary);
 * si algún día llegara relativa, se completa contra el backend activo.
 */
export function resolveAssetUrl(url?: string | null): string | null {
  const value = url?.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value)
    ? value
    : `${API_BASE_URL}${value.startsWith('/') ? '' : '/'}${value}`;
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
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    // Token vencido o sesión inválida: avisa a la app para volver al login.
    if (res.status === 401 && onUnauthorized) onUnauthorized();
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
  /** Sucursal asignada (define el alcance del admin de sucursal). */
  branchId: number | null;
  branchName: string | null;
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
  /** Foto de perfil que sube el picker desde la app móvil (Cloudinary). */
  avatarUrl: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  /** Si puede iniciar sesión en la app móvil de picking. */
  isPicker: boolean;
  /** Sucursal asignada (una sola); null si no tiene. */
  branchId: number | null;
  branchName: string | null;
}

export interface CreatePickUserPayload {
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
  /** Sucursal única a asignar (opcional). */
  branchId?: number | null;
  /** Crear como administrador (superusuario). */
  isSuperuser?: boolean;
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
  /** Categorías asociadas (N:M). */
  categoryIds: number[];
}

export const api = {
  /** Logo y título de la tienda configurados en el admin general (público). */
  storeInfo: () => fetchJson<{ url?: string; title?: string }>('/landing/general'),

  branches: () => fetchJson<Branch[]>('/picking-admin/branches'),

  categories: (branchId?: number | null) =>
    fetchJson<Category[]>(
      `/picking-admin/categories${branchId ? `?branchId=${branchId}` : ''}`,
    ),

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

  products: (branchId: number, search?: string, offset = 0, limit = 60) => {
    const qs = new URLSearchParams({ branchId: String(branchId) });
    if (search && search.trim()) qs.set('search', search.trim());
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return fetchJson<{ total: number; products: CatalogProduct[] }>(
      `/picking-admin/products?${qs.toString()}`,
    );
  },

  metrics: () => fetchJson<PickerSummary[]>('/picking-admin/metrics'),

  /** Pedidos del panel (tab Pedidos), filtrables por sucursal y estado. */
  orders: (params: {
    branchId?: number;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.branchId) qs.set('branchId', String(params.branchId));
    if (params.status) qs.set('status', params.status);
    if (params.search?.trim()) qs.set('search', params.search.trim());
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return fetchJson<PickingAdminOrdersResponse>(`/picking-admin/orders?${qs}`);
  },

  pickerHistory: (id: number) =>
    fetchJson<PickerHistory>(`/picking-admin/pickers/${id}/history`),

  // ─── Chat con pickers ──────────────────────────────────────────────────────
  chatConversations: () => fetchJson<PickerChatConversation[]>('/picking-admin/chats'),

  /** Devuelve el hilo completo; el backend marca como leídos los del picker. */
  chatMessages: (pickerId: number) =>
    fetchJson<PickerChatMessage[]>(`/picking-admin/pickers/${pickerId}/messages`),

  sendChatMessage: (pickerId: number, body: string) =>
    fetchJson<PickerChatMessage>(`/picking-admin/pickers/${pickerId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

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
  users: (branchId?: number | null) =>
    fetchJson<PickUser[]>(
      `/picking-admin/users${branchId ? `?branchId=${branchId}` : ''}`,
    ),

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
