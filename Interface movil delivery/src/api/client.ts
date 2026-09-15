import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { clearTokens, getTokens, setTokens } from "@/auth/storage";
import { getServerUrl } from "@/api/server";

export const USE_MOCK = process.env.EXPO_PUBLIC_USE_MOCK === "true";

export const http = createApiClient(() => `${getServerUrl()}/delivery`);
/** Cliente contra la raíz del backend (p. ej. POST /upload/image). */
export const uploadHttp = createApiClient(() => getServerUrl());

function createApiClient(resolveBaseUrl: () => string) {
  const client = axios.create({
    baseURL: resolveBaseUrl(),
    timeout: 20_000,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use(async (config) => {
    // La base puede cambiar si la app redescubre el servidor en la red local.
    config.baseURL = resolveBaseUrl();
    const tokens = await getTokens();
    if (tokens?.accessToken) {
      config.headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const original = error.config as
        | (InternalAxiosRequestConfig & { _retry?: boolean })
        | undefined;

      if (
        error.response?.status === 401 &&
        original &&
        !original._retry &&
        !String(original.url).includes("/auth/")
      ) {
        original._retry = true;
        refreshPromise ??= doRefresh().finally(() => {
          refreshPromise = null;
        });
        const token = await refreshPromise;
        if (token) {
          original.headers.Authorization = `Bearer ${token}`;
          return client(original);
        }
      }
      return Promise.reject(error);
    },
  );

  return client;
}

let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const tokens = await getTokens();
  if (!tokens?.refreshToken) return null;
  try {
    const res = await axios.post<{ data?: { accessToken: string }; accessToken?: string }>(
      `${getServerUrl()}/delivery/auth/refresh`,
      { refreshToken: tokens.refreshToken },
      { timeout: 10_000 },
    );
    const accessToken = res.data.data?.accessToken ?? res.data.accessToken;
    if (!accessToken) return null;
    await setTokens({ ...tokens, accessToken, expiresIn: 3600 });
    return accessToken;
  } catch {
    await clearTokens();
    // Import diferido para romper el ciclo authStore ↔ client (solo se usa al refrescar).
    const { useAuthStore } = await import("@/auth/authStore");
    // Sin sesión: el layout de (main) redirige a /login; se avisa el motivo.
    useAuthStore.getState().setUser(null);
    useAuthStore.setState({ error: "Tu sesión expiró o no pudo renovarse. Inicia sesión de nuevo." });
    return null;
  }
}

/** El backend Nest envuelve respuestas en { data } — se desempaqueta si aplica. */
export function unwrap<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "data" in payload
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = anyErr?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string" && msg.length > 0) return msg;
  if (typeof anyErr?.message === "string" && anyErr.message.length > 0) {
    return anyErr.message;
  }
  return fallback;
}
