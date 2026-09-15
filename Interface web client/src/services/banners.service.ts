const API_BASE_URL = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"));

const CACHE_TTL_MS = 60_000; // 60s: los banners cambian poco
const FETCH_TIMEOUT_MS = 8_000;

interface CachedEntry {
  at: number;
  data: unknown[];
}

const cache = new Map<string, CachedEntry>();

/**
 * Obtiene los banners de un tipo con caché en memoria y timeout.
 * - Si hay una copia reciente en caché (< 60s), no toca la red.
 * - Si la petición falla o se cuelga, sirve la última copia en caché
 *   (o [] si nunca cargó) para que la UI no quede colgada.
 */
export async function fetchBanners(
  type: "hero" | "promo" | "benefits",
): Promise<any[]> {
  const key = `banners:${type}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/banners?bannerType=${type}`, {
      signal: controller.signal,
    });
    if (!res.ok) return hit?.data ?? [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    cache.set(key, { at: Date.now(), data: list });
    return list;
  } catch {
    return hit?.data ?? [];
  } finally {
    clearTimeout(timer);
  }
}
