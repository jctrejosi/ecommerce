import {
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  deliveryDriverLocations,
  deliveryDrivers,
  shipments,
  branches,
  orders,
} from '../../../drizzle/schema';
import type { LocationDto } from './dto/location.dto';

const OSRM_URL = process.env.OSRM_URL ?? 'http://localhost:5000';

export interface LatLng {
  lat: number;
  lng: number;
}

/** `POINT(lon lat)` → { lng, lat }. Formato usado en la BD (text). */
export function parsePoint(value: string | null | undefined): LatLng | null {
  if (!value) return null;
  const m = value.match(
    /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i,
  );
  if (!m) return null;
  return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
}

/** `lon,lat` (query param) → { lng, lat }. */
function parseLonLat(value: string): LatLng | null {
  const parts = value.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return { lng: parts[0], lat: parts[1] };
}

@Injectable()
export class DeliveryService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async getDriverByAuthUserId(authUserId: number) {
    const rows = await this.db
      .select()
      .from(deliveryDrivers)
      .where(
        and(
          eq(deliveryDrivers.authUserId, authUserId),
          isNull(deliveryDrivers.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Resuelve el repartidor autenticado o lanza 401. */
  async resolveDriver(authUserId: number) {
    const driver = await this.getDriverByAuthUserId(authUserId);
    if (!driver) {
      throw new UnauthorizedException('No hay repartidor asociado a esta cuenta.');
    }
    return driver;
  }

  /** Guarda el ping GPS del repartidor: posición actual + traza histórica. */
  async saveLocation(driverId: number, dto: LocationDto) {
    const point = `POINT(${dto.lng} ${dto.lat})`;
    const recordedAt = dto.timestamp ?? new Date().toISOString();

    await this.db
      .update(deliveryDrivers)
      .set({ currentLocation: point, lastLocationAt: recordedAt })
      .where(eq(deliveryDrivers.id, BigInt(driverId)));

    await this.db.insert(deliveryDriverLocations).values({
      driverId,
      location: point,
      speedKmh: dto.speed != null ? String(dto.speed) : null,
      headingDegrees: dto.heading != null ? Math.round(dto.heading) : null,
      recordedAt,
    });

    return { ok: true, location: { lat: dto.lat, lng: dto.lng } };
  }

  /**
   * Ruta recomendada vía OSRM.
   * `target` = 'customer' (destino de entrega, default) | 'store' (tienda a recoger).
   */
  async getOrderRoute(
    driver: typeof deliveryDrivers.$inferSelect,
    orderId: number,
    from?: string,
    target: 'customer' | 'store' = 'customer',
  ) {
    let destination: LatLng | null = null;

    if (target === 'store') {
      const rows = await this.db
        .select({ location: branches.location })
        .from(orders)
        .innerJoin(branches, eq(branches.id, orders.branchId))
        .where(eq(orders.id, BigInt(orderId)))
        .limit(1);
      destination = parsePoint(rows[0]?.location);
      if (!destination) {
        throw new UnprocessableEntityException(
          'La tienda no tiene coordenadas de recogida.',
        );
      }
    } else {
      const rows = await this.db
        .select({ location: shipments.location })
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
        .limit(1);
      destination = parsePoint(rows[0]?.location);
      if (!destination) {
        throw new UnprocessableEntityException(
          'El pedido no tiene coordenadas de entrega.',
        );
      }
    }

    const origin =
      (from ? parseLonLat(from) : null) ?? parsePoint(driver.currentLocation);
    if (!origin) {
      throw new UnprocessableEntityException(
        'No hay posición de origen (repartidor).',
      );
    }

    const url =
      `${OSRM_URL}/route/v1/car/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
      `?overview=full&geometries=polyline&alternatives=false`;

    let data: any;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new HttpException(`OSRM respondió ${res.status}`, 502);
      }
      data = await res.json();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        'No se pudo conectar con el motor de rutas (OSRM).',
        502,
      );
    }

    const route = data?.routes?.[0];
    if (!route?.geometry) {
      throw new NotFoundException('No se encontró una ruta entre origen y destino.');
    }

    return {
      polyline: route.geometry,
      distanceM: Number(route.distance),
      durationS: Number(route.duration),
    };
  }
}
