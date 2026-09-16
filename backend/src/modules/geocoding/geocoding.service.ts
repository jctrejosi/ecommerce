import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/**
 * Geocodificación de direcciones para el checkout (mapa + marcador).
 *
 * Se apoya en Nominatim (OpenStreetMap) y se expone a través del backend por
 * varias razones:
 *   - Nominatim exige un User-Agent identificable y un uso moderado. Desde el
 *     navegador no se puede fijar ese encabezado y se incumpliría su política.
 *   - Así el proveedor queda en un solo sitio, fácil de cambiar.
 *
 * Límite de uso: 1 petición por segundo (política de Nominatim), por eso hay
 * caché en memoria y una cola que serializa las llamadas.
 */
const NOMINATIM_URL =
  process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';

/** Contacto que exige la política de uso de Nominatim. */
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  'Mercaldas/1.0 (ecommerce; +https://dsi.com.co)';

/** Caché en memoria: evita repetir búsquedas idénticas. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; data: unknown }>();

export interface GeocodePlace {
  /** Texto completo que devuelve el proveedor. */
  label: string;
  /** Dirección corta (calle + ciudad), para rellenar el formulario. */
  address: string;
  city: string | null;
  lat: number;
  lng: number;
}

/** Centro de Manizales: sesga la búsqueda hacia la zona de la tienda. */
const DEFAULT_BIAS = { lat: 5.067, lng: -75.517 };

interface NominatimRow {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  /** Serializa las peticiones a Nominatim (1 req/s). */
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  private cached<T>(key: string): T | null {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return hit.data as T;
  }

  private store(key: string, data: unknown) {
    cache.set(key, { at: Date.now(), data });
    if (cache.size > CACHE_MAX) {
      // Descarta la entrada más vieja para no crecer sin límite.
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
  }

  /** Encola la llamada respetando 1 petición por segundo. */
  private async throttled<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      const wait = 1000 - (Date.now() - this.lastCallAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
      return run();
    });
    // Un fallo no debe romper la cola de las siguientes peticiones.
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async request<T>(path: string, params: Record<string, string>) {
    const url = `${NOMINATIM_URL}${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'es',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      this.logger.warn(`Nominatim ${path} → ${res.status}`);
      throw new BadRequestException(
        `El buscador de direcciones respondió ${res.status}.`,
      );
    }
    return (await res.json()) as T;
  }

  /** Busca direcciones a partir del texto que escribe el cliente. */
  async search(query: string): Promise<GeocodePlace[]> {
    const q = (query ?? '').trim();
    if (q.length < 4) {
      throw new BadRequestException(
        'Escribe al menos 4 caracteres de la dirección.',
      );
    }

    const key = `s:${q.toLowerCase()}`;
    const hit = this.cached<GeocodePlace[]>(key);
    if (hit) return hit;

    // `viewbox` sesga hacia la zona de la tienda sin excluir el país
    // (bounded=0) y countrycodes limita a Colombia.
    const d = 0.6;
    const viewbox = [
      DEFAULT_BIAS.lng - d,
      DEFAULT_BIAS.lat + d,
      DEFAULT_BIAS.lng + d,
      DEFAULT_BIAS.lat - d,
    ].join(',');

    const rows = await this.throttled(() =>
      this.request<NominatimRow[]>('/search', {
        q,
        format: 'jsonv2',
        addressdetails: '1',
        limit: '6',
        countrycodes: 'co',
        viewbox,
        bounded: '0',
        'accept-language': 'es',
      }),
    );

    const places = rows.map((r) => this.toPlace(r));
    this.store(key, places);
    return places;
  }

  /** Dado un punto del mapa, devuelve la dirección más cercana. */
  async reverse(lat: number, lng: number): Promise<GeocodePlace | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('Coordenadas inválidas.');
    }
    // Redondeo a ~11 m: evita llamadas distintas por micro-movimientos.
    const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const hit = this.cached<GeocodePlace | null>(key);
    if (hit !== null) return hit;

    const row = await this.throttled(() =>
      this.request<NominatimRow | null>('/reverse', {
        lat: String(lat),
        lon: String(lng),
        format: 'jsonv2',
        addressdetails: '1',
        zoom: '18',
        'accept-language': 'es',
      }),
    );

    const place = row ? this.toPlace(row, lat, lng) : null;
    this.store(key, place);
    return place;
  }

  private toPlace(
    row: NominatimRow,
    fallbackLat?: number,
    fallbackLng?: number,
  ): GeocodePlace {
    const a = row.address ?? {};
    // Nominatim marca el casco urbano como "Perímetro Urbano Manizales": para el
    // formulario sobra el prefijo.
    const rawCity =
      a.municipality ?? a.city ?? a.town ?? a.village ?? a.county ?? null;
    const city = rawCity
      ? rawCity.replace(/^Perímetro Urbano\s+/i, "").trim()
      : null;

    // Calle + número si están; si no, el barrio, que es lo que diferencia unos
    // resultados de otros cuando el proveedor no tiene el número.
    const road = [a.road, a.house_number].filter(Boolean).join(" ");
    const barrio = a.neighbourhood ?? a.suburb ?? null;

    const seen = new Set<string>();
    const parts = [road || barrio, barrio, city].filter((p): p is string => {
      if (!p) return false;
      const key = p.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      label: row.display_name,
      address: parts.join(", ") || row.display_name,
      city,
      lat: Number(row.lat) || fallbackLat || 0,
      lng: Number(row.lon) || fallbackLng || 0,
    };
  }
}
