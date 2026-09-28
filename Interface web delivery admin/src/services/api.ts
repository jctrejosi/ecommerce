import type {
  AuthUser,
  DriverChatMessage,
  DriverConversation,
  FleetDriver,
  FleetOrder,
  LoginResponse,
} from '../types';

/**
 * Base del API.
 *
 * El panel se abre tanto en `localhost` como desde el celular con la IP del
 * equipo en la red local (la que imprime `dev.js`). Si la URL configurada
 * apunta a localhost y la página NO se sirvió desde localhost, se resuelve
 * contra el host que sirvió la página: si no, el navegador del celular
 * buscaría el backend en el propio celular.
 */
function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL ?? '';
  const configuredIsLocal = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/.test(configured);
  const pageIsLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

  if (configured && (!configuredIsLocal || pageIsLocal)) return configured;

  const port = (() => {
    try {
      return new URL(configured).port || '3000';
    } catch {
      return '3000';
    }
  })();
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export const API_BASE_URL = resolveApiBaseUrl();

const TOKEN_KEY = 'delivery_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    let payload: unknown = null;
    try {
      payload = await res.json();
      const m = (payload as { message?: unknown } | null)?.message;
      if (typeof m === 'string') message = m;
      else if (Array.isArray(m)) message = m.map(String).join(', ');
    } catch {
      /* sin cuerpo JSON */
    }
    throw new ApiError(message, res.status, payload);
  }
  return res.json() as Promise<T>;
}

export interface CreateDriverPayload {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  firstName?: string;
  lastName?: string;
  vehicleType?: string;
  vehiclePlate?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  /** Capacidad de carga del vehículo en cm³ (1 L = 1.000 cm³). */
  cargoVolumeCm3?: number;
}

export interface UpdateDriverPayload {
  fullName?: string;
  username?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  vehicleType?: string;
  vehiclePlate?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  isAvailable?: boolean;
  isActive?: boolean;
  /** Color (#RRGGBB) de la ruta del repartidor en el mapa. */
  routeColor?: string;
  /** Capacidad de carga en cm³; `null` la borra. */
  cargoVolumeCm3?: number | null;
}

/** Ruta por calles (OSRM) para pintar en el mapa de flota. */
export interface OrderRoute {
  /** Polyline (precisión 5) lista para decodificar a coordenadas. */
  polyline: string;
  distanceM: number;
  durationS: number;
}

export const api = {
  login: (identifier: string, password: string) =>
    fetchJson<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  me: () => fetchJson<AuthUser>('/auth/me'),

  drivers: () => fetchJson<FleetDriver[]>('/delivery/admin/drivers'),

  driver: (id: number) => fetchJson<FleetDriver>(`/delivery/admin/drivers/${id}`),

  createDriver: (payload: CreateDriverPayload) =>
    fetchJson<FleetDriver>('/delivery/admin/drivers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDriver: (id: number, payload: UpdateDriverPayload) =>
    fetchJson<FleetDriver>(`/delivery/admin/drivers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  resetPassword: (id: number, password: string) =>
    fetchJson<{ success: boolean }>(`/delivery/admin/drivers/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  orders: () => fetchJson<FleetOrder[]>('/delivery/admin/orders'),

  // ── Chat repartidor ↔ admin ─────────────────────────────────────────────────

  /** Bandeja: un renglón por repartidor con no leídos y último mensaje. */
  chats: () =>
    fetchJson<DriverConversation[]>('/delivery/admin/chats', { cache: 'no-store' }),

  /** Hilo con un repartidor. Al leerlo, el backend lo marca como leído. */
  chatMessages: (driverId: number) =>
    fetchJson<DriverChatMessage[]>(`/delivery/admin/drivers/${driverId}/messages`, {
      cache: 'no-store',
    }),

  sendChatMessage: (driverId: number, body: string) =>
    fetchJson<DriverChatMessage>(`/delivery/admin/drivers/${driverId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  /**
   * Ruta por calles (OSRM) de un pedido. `from` (`lng,lat`) permite calcular
   * rutas que no parten del repartidor (p. ej. tienda → domicilio).
   */
  orderRoute: (orderId: number, target: 'customer' | 'store', from?: string) =>
    fetchJson<OrderRoute>(
      `/delivery/admin/orders/${orderId}/route?target=${target}${
        from ? `&from=${encodeURIComponent(from)}` : ''
      }`,
      // La ruta cambia con la posición: sin caché, para evitar 304 sin cuerpo.
      { cache: 'no-store' },
    ),
};
