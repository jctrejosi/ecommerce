import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

/**
 * Cliente HTTP del backend (misma API del web client).
 * Guarda el JWT en SecureStore y refresca el access token una vez ante un 401.
 */

/**
 * URL de la API. Precedencia: `app.json` → `extra.apiUrl` → `EXPO_PUBLIC_API_URL`
 * (build) → host público por defecto. Así se puede cambiar sin editar el `.env`.
 */
export const API_BASE_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  process.env.EXPO_PUBLIC_API_URL ||
  "https://ecommerce.jcti.xyz";

const ACCESS_KEY = "mercaldas.accessToken";
const REFRESH_KEY = "mercaldas.refreshToken";

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}
export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}
export async function persistTokens(accessToken: string | null, refreshToken?: string | null) {
  if (accessToken) await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
  else await SecureStore.deleteItemAsync(ACCESS_KEY);
  if (refreshToken !== undefined) {
    if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = await getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/customer-auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    await persistTokens(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // adjunta Authorization: Bearer
  retried?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = false, retried = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = await getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !retried) {
    const ok = await refreshAccessToken();
    if (ok) {
      return apiFetch<T>(path, { ...options, retried: true });
    }
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (Array.isArray(json?.message) ? json.message.join(", ") : undefined) ||
      json?.message ||
      json?.error?.reason ||
      `Error ${res.status}`;
    throw new ApiError(String(message), res.status);
  }
  return json as T;
}
