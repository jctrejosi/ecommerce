import NetInfo from "@react-native-community/netinfo";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Descubrimiento del backend en la red local.
 *
 * El APK trae una pista de compilación (`EXPO_PUBLIC_API_URL`), pero al cambiar
 * de red esa IP deja de servir. Por eso la app:
 *   1. prueba la URL guardada en el dispositivo,
 *   2. prueba la pista del build,
 *   3. escanea la subred local (misma /24 que el celular) buscando `GET /discovery`.
 *
 * La URL que responde se guarda para los siguientes arranques.
 */

/** Identificador que devuelve el backend en `GET /discovery`. */
export const SERVICE_ID = "mercaldas-backend";
const DEFAULT_PORT = 3000;
const STORAGE_KEY = "dsi_delivery_server_url";
/** Pista compilada en el APK (puede venir vacía). */
const BUILD_HINT = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

let currentUrl = BUILD_HINT;

/** URL del backend vigente (cadena vacía si aún no se ha resuelto). */
export function getServerUrl(): string {
  return currentUrl;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function setServerUrl(url: string): void {
  currentUrl = normalizeUrl(url);
}

async function readStoredUrl(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(STORAGE_KEY)
        : null;
    }
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeStoredUrl(url: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, url);
      return;
    }
    await SecureStore.setItemAsync(STORAGE_KEY, url);
  } catch {
    /* sin persistencia: se seguirá usando en esta sesión */
  }
}

/**
 * ¿Hay un backend nuestro respondiendo en `url`?
 * Se prueba `GET /discovery` (ligero, sin BD) y, como respaldo, `/api-status`.
 */
export async function pingServer(url: string, timeoutMs = 900): Promise<boolean> {
  const base = normalizeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/discovery`, { signal: controller.signal });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { service?: string }
        | null;
      if (data?.service === SERVICE_ID) return true;
    }
    // Backend anterior sin /discovery: se acepta /api-status con status ok.
    const legacy = await fetch(`${base}/api-status`, { signal: controller.signal });
    if (!legacy.ok) return false;
    const legacyData = (await legacy.json().catch(() => null)) as
      | { status?: string }
      | null;
    return legacyData?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** IP local del dispositivo (Wi-Fi), si el sistema la expone. */
export async function deviceIpv4(): Promise<string | null> {
  try {
    const state = await NetInfo.fetch();
    const details = state.details as { ipAddress?: string | null } | null;
    const ip = details?.ipAddress;
    if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  } catch {
    /* sin información de red */
  }
  return null;
}

/** Prefijo /24 de una IPv4 ("192.168.0.113" → "192.168.0."). */
export function networkPrefixOf(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.`;
}

/**
 * Avisa cuando cambia la red local (cambia el prefijo /24 de la IP del
 * celular): así la app puede volver a buscar el servidor sin reiniciarse.
 * Devuelve una función para cancelar la suscripción.
 */
export function watchNetworkPrefix(
  onChange: (prefix: string) => void,
): () => void {
  let last: string | null = null;
  const unsubscribe = NetInfo.addEventListener((state) => {
    const details = state.details as { ipAddress?: string | null } | null;
    const prefix = networkPrefixOf(details?.ipAddress ?? null);
    if (!prefix) return;
    if (last === null) {
      last = prefix;
      return;
    }
    if (prefix !== last) {
      last = prefix;
      onChange(prefix);
    }
  });
  return () => unsubscribe();
}

/** Prefijo /24 de una IPv4 ("192.168.0.113" → "192.168.0."). */
function subnetPrefix(ip: string): string | null {
  return networkPrefixOf(ip);
}

/** Escanea la subred en lotes y devuelve la primera URL que responde. */
async function scanSubnet(prefix: string): Promise<string | null> {
  const BATCH = 40;
  const TIMEOUT_MS = 600;
  const hosts = Array.from({ length: 254 }, (_, i) => i + 1);
  for (let i = 0; i < hosts.length; i += BATCH) {
    const batch = hosts.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (host) => {
        const url = `http://${prefix}${host}:${DEFAULT_PORT}`;
        return (await pingServer(url, TIMEOUT_MS)) ? url : null;
      }),
    );
    const hit = results.find((r): r is string => r !== null);
    if (hit) return hit;
  }
  return null;
}

export interface ResolveResult {
  /** URL del backend si se encontró, o null. */
  url: string | null;
  /** Direcciones que se probaron (útil para mostrar diagnóstico). */
  tried: string[];
}

/**
 * Resuelve la URL del backend: guardada → pista del build → escaneo de la LAN.
 * Deja la URL vigente lista para los clientes HTTP.
 */
export async function resolveServer(): Promise<ResolveResult> {
  const tried: string[] = [];
  const candidates: string[] = [];
  const stored = await readStoredUrl();
  if (stored) candidates.push(stored);
  if (BUILD_HINT) candidates.push(BUILD_HINT);

  for (const candidate of candidates) {
    if (tried.includes(candidate)) continue;
    tried.push(candidate);
    if (await pingServer(candidate)) {
      setServerUrl(candidate);
      await writeStoredUrl(currentUrl);
      return { url: currentUrl, tried };
    }
  }

  const ip = await deviceIpv4();
  const prefix = ip ? subnetPrefix(ip) : null;
  if (prefix) {
    tried.push(`${prefix}*:${DEFAULT_PORT} (escaneo)`);
    const found = await scanSubnet(prefix);
    if (found) {
      setServerUrl(found);
      await writeStoredUrl(currentUrl);
      return { url: currentUrl, tried };
    }
  }

  return { url: null, tried };
}
