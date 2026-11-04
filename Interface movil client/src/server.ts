import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { WEB_CLIENT_URL } from "./webview";

/**
 * Descubrimiento del servidor del cliente en la red local.
 *
 * El WebView apunta a la web del cliente (y su API por el mismo origen). La IP
 * del build puede dejar de servir al cambiar de red, así que la app:
 *   1. prueba la URL guardada en el dispositivo,
 *   2. prueba la pista de compilación (`EXPO_PUBLIC_WEB_URL`),
 *   3. prueba la URL por defecto de `src/webview.ts` como pista,
 *   4. escanea la subred local (misma /24 que el celular) buscando `GET /discovery`.
 *
 * En los tres primeros casos, y también al encontrar el servidor por escaneo, se
 * usa la URL configurada. En producción es el dominio público
 * (`https://mercaldas.jcti.xyz`), que sirve la web y su API por el mismo origen;
 * en desarrollo se compila con `EXPO_PUBLIC_WEB_URL` apuntando a la IP local.
 *
 * La URL que responde se guarda para los siguientes arranques.
 */

/** Identificador que devuelve el servidor en `GET /discovery`. */
export const SERVICE_ID = "mercaldas-webclient";
/** Puerto por defecto del servidor web/API del cliente. */
export const DEFAULT_PORT = 4173;
/** Clave de persistencia de la URL vigente. */
const STORAGE_KEY = "mercaldas_web_url";
/** Pista compilada en el APK (puede venir vacía). */
const BUILD_HINT = (process.env.EXPO_PUBLIC_WEB_URL ?? "").replace(/\/+$/, "");
/** Cadencia del polling de red (expo-network no expone listener). */
const NETWORK_POLL_MS = 5000;

let currentUrl = "";

/** URL del servidor vigente (cadena vacía si aún no se ha resuelto). */
export function getServerUrl(): string {
  return currentUrl;
}

/**
 * Normaliza una dirección escrita a mano o configurada: añade `http://` si
 * falta el esquema y el puerto por defecto si no se especifica ninguno.
 */
function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  // HTTPS usa el puerto 443 por defecto: nunca se le añade 4173.
  if (/^https:\/\//i.test(withScheme)) return withScheme;
  return /^https?:\/\/[^/]+:\d+/i.test(withScheme)
    ? withScheme
    : `${withScheme}:${DEFAULT_PORT}`;
}

export function setServerUrl(url: string): void {
  currentUrl = normalizeUrl(url);
}

async function readStoredUrl(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeStoredUrl(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, url);
  } catch {
    /* sin persistencia: la URL se seguirá usando en esta sesión */
  }
}

/**
 * ¿Hay un servidor nuestro respondiendo en `url`?
 * En LAN se valida el identificador de `/discovery`. En producción el front es
 * estático y no expone `/discovery`, pero un origen HTTPS que responde la raíz
 * es suficiente (la URL viene de la pista de compilación, no de un escaneo).
 */
export async function pingServer(url: string, timeoutMs = 3000): Promise<boolean> {
  const base = normalizeUrl(url);
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/discovery`, { signal: controller.signal });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { service?: string }
        | null;
      if (
        data?.service === SERVICE_ID ||
        data?.service === "mercaldas-backend"
      ) {
        return true;
      }
    }
    if (/^https:\/\//i.test(base)) {
      const root = await fetch(`${base}/`, { signal: controller.signal });
      return root.ok;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** IP local del dispositivo (Wi-Fi), si el sistema la expone. */
export async function deviceIpv4(): Promise<string | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    // expo-network devuelve "0.0.0.0" cuando no puede resolverla.
    if (ip && ip !== "0.0.0.0" && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      return ip;
    }
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
 * Escanea la subred en lotes de 40 hosts (timeout 600 ms) y devuelve la
 * primera URL que responde al descubrimiento.
 */
export async function scanSubnet(prefix: string): Promise<string | null> {
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
  /** URL del servidor si se encontró, o null. */
  url: string | null;
  /** Direcciones que se probaron (útil para mostrar diagnóstico). */
  tried: string[];
}

/**
 * Resuelve la URL del servidor: guardada → pista del build → valor por defecto
 * de `webview.ts` → escaneo de la LAN. Deja la URL vigente lista y persistida.
 */
export async function resolveServer(): Promise<ResolveResult> {
  const tried: string[] = [];
  const candidates: string[] = [];

  // Migración: versiones anteriores guardaban/compilaban el alias `sslip.io`
  // (ya no se usa; el login con Google ahora usa la IP literal).
  const isLegacyAlias = (url: string) => /sslip\.io/i.test(url);
  const stored = await readStoredUrl();
  if (stored && !isLegacyAlias(stored)) candidates.push(stored);
  if (BUILD_HINT && !isLegacyAlias(BUILD_HINT)) candidates.push(BUILD_HINT);
  candidates.push(WEB_CLIENT_URL);

  for (const candidate of candidates) {
    const candidateUrl = normalizeUrl(candidate);
    if (!candidateUrl || tried.includes(candidateUrl)) continue;
    tried.push(candidateUrl);
    if (await pingServer(candidateUrl)) {
      setServerUrl(candidateUrl);
      await writeStoredUrl(currentUrl);
      return { url: currentUrl, tried };
    }
  }

  const ip = await deviceIpv4();
  const prefix = networkPrefixOf(ip);
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

/**
 * Avisa cuando cambia la red local (cambia el prefijo /24 de la IP del
 * celular). `expo-network` no expone un listener, así que se consulta la IP
 * cada 5 s. Devuelve una función para cancelar la suscripción.
 */
export function watchNetworkPrefix(
  onChange: (prefix: string) => void,
): () => void {
  let last: string | null = null;
  let cancelled = false;

  const poll = async (): Promise<void> => {
    const prefix = networkPrefixOf(await deviceIpv4());
    if (cancelled || !prefix) return;
    if (last === null) {
      last = prefix;
      return;
    }
    if (prefix !== last) {
      last = prefix;
      onChange(prefix);
    }
  };

  void poll();
  const timer = setInterval(() => {
    void poll();
  }, NETWORK_POLL_MS);

  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}
