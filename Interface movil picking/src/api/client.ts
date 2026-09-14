import axios from "axios";
import type { AxiosError } from "axios";
import { clearTokens, getTokens } from "@/auth/session";
import { getApiUrl } from "./apiConfig";

/**
 * Cliente HTTP. La URL del backend es configurable en runtime
 * (Ajustes → Servidor) y se aplica en cada petición.
 */
export const http = axios.create({
  timeout: 20_000,
  headers: { "Content-Type": "application/json" },
});

// Adjunta el token de sesión (si lo hay) a todas las peticiones.
http.interceptors.request.use(async (config) => {
  config.baseURL = getApiUrl();
  const tokens = await getTokens();
  if (tokens?.accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

// Si el token expiró, cierra la sesión para forzar el login de nuevo.
http.interceptors.response.use(
  (res) => {
    // Cada respuesta cuenta como actividad (vencimiento por inactividad).
    void import("@/auth/authStore").then(({ useAuthStore }) =>
      useAuthStore.getState().touchActivity(),
    );
    return res;
  },
  async (error: AxiosError) => {
    const status = error.response?.status;
    const url = String(error.config?.url ?? "");
    // Solo /auth/login queda exento (un login fallido no debe cerrar sesión).
    if (status === 401 && !url.includes("/auth/login")) {
      await clearTokens();
      const { useAuthStore } = await import("@/auth/authStore");
      useAuthStore.getState().setUser(null);
    }
    return Promise.reject(error);
  },
);

/** Error de API que conserva el payload del backend (p. ej. `expected` del scan). */
export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function toApiError(err: unknown, fallback: string): ApiError {
  const e = err as AxiosError<{ message?: string | string[] }>;
  const data = e?.response?.data;
  const raw = data?.message;
  let message = fallback;
  if (Array.isArray(raw)) message = raw.join(", ");
  else if (typeof raw === "string" && raw.length > 0) message = raw;
  else if (typeof e?.message === "string" && e.message.length > 0) message = e.message;
  return new ApiError(message, e?.response?.status ?? 0, data);
}

/** Mensaje legible para mostrar en UI. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return toApiError(err, fallback).message;
}
