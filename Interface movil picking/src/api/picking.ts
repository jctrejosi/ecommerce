import { http, toApiError } from "./client";
import type {
  AuthMe,
  LoginResponse,
  PickerChatMessage,
  PickerChatSummary,
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

async function put<T>(url: string, body?: unknown): Promise<T> {
  try {
    const res = await http.put<T>(url, body);
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

  /** Logo y título de la tienda que se configuran en el admin (público). */
  storeInfo: () => get<{ url?: string; title?: string }>("/landing/general"),

  queue: (status?: string) =>
    get<PickingOrder[]>(`/picking/orders${status ? `?status=${status}` : ""}`),

  unreviewedCount: () => get<{ count: number }>("/picking/orders/unreviewed-count"),

  detail: (id: number) => get<PickingOrder>(`/picking/orders/${id}`),

  markReviewed: (id: number) =>
    post<{ reviewed: boolean }>(`/picking/orders/${id}/reviewed`),

  scan: (id: number, code: string) =>
    post<ScanResult>(`/picking/orders/${id}/scan`, { code }),

  /** Cierre de turno de hoy (entre todas las sucursales). */
  shiftToday: () => get<{ day: string; closeTime: string | null }>("/picking-admin/shift-today"),

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

  /** Hilo con administración. El GET marca como leído lo que envió el admin. */
  chatMessages: () => get<PickerChatMessage[]>("/picking/chat"),

  chatSummary: () => get<PickerChatSummary>("/picking/chat/summary"),

  sendChatMessage: (body: string) =>
    post<PickerChatMessage>("/picking/chat", { body }),

  /**
   * Registra el token FCM del dispositivo para recibir push (pedidos y chat).
   *
   * Es idempotente: al iniciar sesión se vuelve a enviar para que el backend
   * apunte al dispositivo actual del picker.
   */
  registerPushToken: (token: string) =>
    put<{ ok: boolean }>("/picking/profile/push-token", { token }),

  // ─── Perfil del picker (app móvil) ────────────────────────────────────────

  /** Cambio de la propia contraseña; el backend exige la actual. */
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ success: boolean }>("/picking/profile/password", {
      currentPassword,
      newPassword,
    }),

  /**
   * Foto de perfil: el archivo va al backend, que lo publica en Cloudinary y
   * guarda la URL en el usuario. Devuelve la URL pública, que es la misma que
   * muestra el panel de picking admin.
   */
  uploadAvatar: async (uri: string) => {
    const form = new FormData();
    form.append("file", {
      uri,
      name: `avatar_${Date.now()}.jpg`,
      type: "image/jpeg",
    } as unknown as Blob);
    try {
      const res = await http.post<{ ok: boolean; avatarUrl: string }>(
        "/picking/profile/avatar",
        form,
        {
          // La subida incluye el procesado de la imagen en el backend.
          timeout: 60_000,
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      return res.data;
    } catch (err) {
      throw toApiError(err, "No se pudo subir la foto de perfil");
    }
  },
};

export type { PickingLocation, PickingOrder, PickingShelf, ScanResult };
