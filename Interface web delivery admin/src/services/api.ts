import type {
  AuthUser,
  FleetDriver,
  FleetOrder,
  LoginResponse,
} from '../types';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
};
