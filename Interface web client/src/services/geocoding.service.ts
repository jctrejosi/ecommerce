/**
 * Resolución de direcciones para el mapa del checkout (marcador ↔ dirección).
 * Va contra el backend, que a su vez consulta Nominatim con un User-Agent
 * válido y respeta su límite de 1 petición por segundo.
 */
const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3000")
) as string;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init });
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message = Array.isArray(json?.message)
      ? json.message.join(", ")
      : json?.message || json?.error;
    throw new Error(message || "No se pudo resolver la dirección");
  }

  return json as T;
}

export type GeocodePlace = {
  /** Texto completo que devuelve el proveedor. */
  label: string;
  /** Dirección corta (calle + ciudad), para rellenar el formulario. */
  address: string;
  city: string | null;
  lat: number;
  lng: number;
};

export const geocodingService = {
  /** Busca direcciones por texto (mínimo 4 caracteres). */
  async search(query: string): Promise<GeocodePlace[]> {
    const q = query.trim();
    if (q.length < 4) return [];
    return fetchJson<GeocodePlace[]>(
      `${API_BASE_URL}/geocode/search?q=${encodeURIComponent(q)}`,
    );
  },

  /** Dirección más cercana a un punto del mapa. */
  async reverse(lat: number, lng: number): Promise<GeocodePlace | null> {
    return fetchJson<GeocodePlace | null>(
      `${API_BASE_URL}/geocode/reverse?lat=${lat}&lng=${lng}`,
    );
  },
};
