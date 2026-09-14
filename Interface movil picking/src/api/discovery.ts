import * as Network from "expo-network";
import { getApiUrl, loadApiUrl, setApiUrl } from "./apiConfig";

/** Puerto y endpoint de salud del backend de MercAldas. */
const PORT = "3000";
const PROBE_PATH = "/api-status";

/**
 * Prueba si en `url` responde el backend (GET /api-status → { status: "ok" }).
 */
export async function probeBackend(url: string, timeoutMs = 700): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}${PROBE_PATH}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { status?: string } | null;
    return data?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Extrae el prefijo de subred (p. ej. "192.168.0") de una IP. */
function subnetOf(ip: string): string | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/**
 * Barre la subred local (concurrencia limitada) buscando un host con el
 * backend en el puerto 3000. Los primeros candidatos son IPs típicas
 * (gateway .1, .4, .100, .132) para encontrarlo en la primera tanda.
 */
async function sweepSubnet(subnet: string, deviceIp: string): Promise<string | null> {
  const commons = [1, 4, 100, 132, 2, 3, 5, 6, 7, 8, 9, 10];
  const rest: number[] = [];
  for (let i = 2; i <= 254; i += 1) {
    if (!commons.includes(i)) rest.push(i);
  }
  const order = [...commons, ...rest];

  let cursor = 0;
  const worker = async (): Promise<string | null> => {
    for (;;) {
      const host = order[cursor];
      cursor += 1;
      if (host === undefined) return null;
      const ip = `${subnet}.${host}`;
      if (ip === deviceIp) continue;
      const candidate = `http://${ip}:${PORT}`;
      if (await probeBackend(candidate, 600)) return candidate;
    }
  };

  const CONCURRENCY = 16;
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results.find((r) => r !== null) ?? null;
}

/**
 * Busca el backend automáticamente:
 *  1. Prueba la URL actual (guardada/default) — camino rápido.
 *  2. Si no responde, barre la subred local y toma la primera que responda.
 */
export async function findBackend(): Promise<string | null> {
  const current = getApiUrl();
  if (await probeBackend(current)) return current;

  const deviceIp = await Network.getIpAddressAsync().catch(() => null);
  const subnet = deviceIp ? subnetOf(deviceIp) : null;
  if (!subnet) return null;

  return sweepSubnet(subnet, deviceIp ?? "");
}

/**
 * Arranque: carga la URL guardada y, si es necesario, descubre el servidor en
 * la red local. Devuelve la URL final activa.
 */
export async function bootApiUrl(): Promise<string> {
  await loadApiUrl();
  const found = await findBackend();
  if (found) await setApiUrl(found);
  return getApiUrl();
}
