import { http, toApiError } from "./client";
import type {
  AuthMe,
  LoginResponse,
  Picker,
  PickingLocation,
  PickingOrder,
  PickingShelf,
  ScanResult,
} from "./types";

async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  try {
    const res = await http.get<T>(url, { params });
    return res.data;
  } catch (err) {
    throw toApiError(err, "No se pudo conectar con el servidor");
  }
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  try {
    const res = await http.post<T>(url, body);
    return res.data;
  } catch (err) {
    throw toApiError(err, "No se pudo completar la operación");
  }
}

export const pickingApi = {
  /** Inicia sesión con email o username + contraseña. */
  login: (identifier: string, password: string) =>
    post<LoginResponse>("/auth/login", { identifier, password }),

  /** Perfil del usuario autenticado (valida el token guardado). */
  me: () => get<AuthMe>("/auth/me"),

  queue: (status?: string) =>
    get<PickingOrder[]>(`/picking/orders${status ? `?status=${status}` : ""}`),

  unreviewedCount: () => get<{ count: number }>("/picking/orders/unreviewed-count"),

  detail: (id: number) => get<PickingOrder>(`/picking/orders/${id}`),

  markReviewed: (id: number) =>
    post<{ reviewed: boolean }>(`/picking/orders/${id}/reviewed`),

  scan: (id: number, code: string) =>
    post<ScanResult>(`/picking/orders/${id}/scan`, { code }),

  complete: (id: number) =>
    post<{ ok: boolean; status: string; already?: boolean }>(`/picking/orders/${id}/complete`),

  claim: (id: number, pickerId: number) =>
    post<{ success: boolean; pickerId: number; firstClaim?: boolean }>(
      `/picking/orders/${id}/claim`,
      { pickerId },
    ),

  shelves: (branchId: number) =>
    get<PickingShelf[]>("/picking-admin/shelves", { branchId }),

  locations: (branchId: number, variantIds: number[]) =>
    get<PickingLocation[]>("/picking-admin/locations", {
      branchId,
      variantIds: variantIds.join(","),
    }),

  pickers: () => get<Picker[]>("/picking-admin/pickers"),
};

export type { Picker, PickingLocation, PickingOrder, PickingShelf, ScanResult };
