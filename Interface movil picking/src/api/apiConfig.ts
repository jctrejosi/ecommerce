import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "picking.apiUrl";

/** URL por defecto: EXPO_PUBLIC_API_URL al compilar, o localhost para emulador. */
export const DEFAULT_API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:3000"
).replace(/\/+$/, "");

let current = DEFAULT_API_URL;
let hydrated = false;

/** Normaliza lo que escriba el usuario: le agrega http:// si falta y quita el / final. */
export function normalizeApiUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_API_URL;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/** URL activa en memoria (sin esperar a AsyncStorage). */
export function getApiUrl(): string {
  return current;
}

/**
 * Resuelve la URL de un recurso que entrega el backend (por ejemplo el logo de
 * la tienda): Cloudinary ya manda URLs absolutas, y si algún día llega una
 * relativa se completa contra el backend activo.
 */
export function resolveAssetUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${current}${value.startsWith("/") ? "" : "/"}${value}`;
}

/** Carga la URL guardada (o deja la default) al arrancar. */
export async function loadApiUrl(): Promise<string> {
  if (hydrated) return current;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) current = normalizeApiUrl(stored);
  } catch {
    /* sin config previa */
  }
  hydrated = true;
  return current;
}

/** Guarda una URL nueva y la deja activa de inmediato. */
export async function setApiUrl(raw: string): Promise<string> {
  current = normalizeApiUrl(raw);
  hydrated = true;
  try {
    await AsyncStorage.setItem(KEY, current);
  } catch {
    /* noop */
  }
  return current;
}
