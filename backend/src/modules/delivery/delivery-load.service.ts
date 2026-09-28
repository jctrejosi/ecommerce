import { Injectable } from '@nestjs/common';
import { DrizzleService } from '../../database/drizzle.service';

/**
 * Estados de asignación que ocupan cupo en el vehículo: el repartidor ya se
 * comprometió con el pedido y todavía no lo entregó.
 *
 * `ASSIGNED` queda fuera a propósito: en el modelo actual es solo una *oferta*
 * (todos los repartidores reciben una por cada pedido nuevo), no carga real.
 */
export const LOAD_STATUSES = [
  'ACCEPTED',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'IN_DELIVERY',
] as const;

/**
 * Volumen de respaldo para las unidades sin dimensiones en el catálogo
 * (1.000 cm³ ≈ una caja de 10×10×10 cm). Configurable por entorno.
 */
export function fallbackVolumeCm3(): number {
  const raw = Number(process.env.DEFAULT_ITEM_VOLUME_CM3);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

/**
 * Rango de volumen unitario aceptable en cm³. Fuera de él, las dimensiones del
 * catálogo se consideran corruptas y se usa el volumen de respaldo.
 *
 * Hace falta porque hay medidas basura en la BD: un limpiador de 240 g con
 * 411×992×1963 mm (el tamaño de un armario) o una salsa de 177 g con
 * `height_mm = 20.190.634` (≈ 40 m³). Sin el filtro, un solo registro malo
 * inflaba el pedido completo a más de 2 m³.
 *
 * El techo de 50 L deja pasar bultos grandes y electrodomésticos pequeños, y
 * descarta lo imposible para un pedido de supermercado. Es ajustable con
 * `MAX_ITEM_VOLUME_CM3` cuando el catálogo tenga medidas confiables.
 */
export function itemVolumeRange(): { min: number; max: number } {
  const min = Number(process.env.MIN_ITEM_VOLUME_CM3);
  const max = Number(process.env.MAX_ITEM_VOLUME_CM3);
  return {
    min: Number.isFinite(min) && min >= 0 ? min : 1,
    max: Number.isFinite(max) && max > 0 ? max : 50_000,
  };
}

export interface OrderLoad {
  /** Volumen total del pedido en cm³ (incluye el respaldo de ítems sin datos). */
  volumeCm3: number;
  /** true si algún ítem no tenía dimensiones utilizables: volumen aproximado. */
  estimated: boolean;
  /** Líneas del pedido sin dimensiones (o con medidas fuera de rango). */
  itemsMissingDims: number;
  /** Líneas descartadas por medidas fuera del rango plausible. */
  itemsOutOfRange: number;
  /** Unidades totales del pedido. */
  units: number;
}

export interface DriverLoad {
  driverId: number;
  /** Capacidad declarada del vehículo en cm³ (null = sin declarar). */
  capacityCm3: number | null;
  /** Volumen comprometido en pedidos activos. */
  usedCm3: number;
  /** Pedidos activos que consumen cupo. */
  orders: number;
  /** true si algún pedido activo tiene volumen estimado. */
  estimated: boolean;
  /** Ocupación 0..1 (null si no hay capacidad declarada). */
  fill: number | null;
  /** true si la carga supera la capacidad declarada. */
  overloaded: boolean;
}

/** Fila cruda del cálculo de volumen de un pedido. */
interface OrderLoadRow {
  volume_cm3: string | number | null;
  items_missing_dims: string | number;
  items_out_of_range: string | number;
  units: string | number;
  units_missing_dims: string | number;
}

/** Fila cruda del cupo por repartidor. */
interface DriverLoadRow {
  driver_id: string;
  capacity_cm3: number | null;
  used_cm3: string | number | null;
  orders: string | number;
  estimated_count: string | number;
}

@Injectable()
export class DeliveryLoadService {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Volumen del pedido a partir de `order_items` × dimensiones de la variante.
   * `1 cm³ = 1.000 mm³`, de ahí el `/1000` sobre `l × w × h` en milímetros.
   *
   * Se usa `quantity` (lo pedido), no `picked_qty`: el cupo se reserva con lo
   * que el pedido va a llevar, y al salir de picking ambos coinciden.
   */
  async computeOrderLoad(orderId: number): Promise<OrderLoad> {
    const { min, max } = itemVolumeRange();
    const rows = await this.drizzle.execute<OrderLoadRow>(
      `WITH items AS (
         SELECT
           oi.quantity,
           CASE
             WHEN v.length_mm IS NULL OR v.width_mm IS NULL OR v.height_mm IS NULL
               THEN NULL
             ELSE v.length_mm::numeric * v.width_mm::numeric * v.height_mm::numeric / 1000.0
           END AS unit_cm3
         FROM order_items oi
         LEFT JOIN product_variants v ON v.id = oi.product_variant_id
         WHERE oi.order_id = $1
       )
       SELECT
         COALESCE(SUM(unit_cm3 * quantity)
                  FILTER (WHERE unit_cm3 BETWEEN $2 AND $3), 0) AS volume_cm3,
         COUNT(*) FILTER (
           WHERE unit_cm3 IS NULL OR unit_cm3 NOT BETWEEN $2 AND $3
         )                                                    AS items_missing_dims,
         COUNT(*) FILTER (
           WHERE unit_cm3 IS NOT NULL AND unit_cm3 NOT BETWEEN $2 AND $3
         )                                                    AS items_out_of_range,
         COALESCE(SUM(quantity), 0)                           AS units,
         COALESCE(SUM(quantity) FILTER (
           WHERE unit_cm3 IS NULL OR unit_cm3 NOT BETWEEN $2 AND $3
         ), 0)                                                AS units_missing_dims
       FROM items`,
      [orderId, min, max],
    );

    const row = rows[0];
    const known = Math.round(Number(row?.volume_cm3 ?? 0));
    const itemsMissingDims = Number(row?.items_missing_dims ?? 0);
    const units = Number(row?.units ?? 0);
    const unitsMissingDims = Number(row?.units_missing_dims ?? 0);

    return {
      volumeCm3: known + unitsMissingDims * fallbackVolumeCm3(),
      estimated: itemsMissingDims > 0,
      itemsMissingDims,
      itemsOutOfRange: Number(row?.items_out_of_range ?? 0),
      units,
    };
  }

  /**
   * Calcula el volumen del pedido y lo guarda como snapshot en su envío.
   * Se llama cuando el pedido sale de picking, para que el dato quede fijo
   * (aunque luego cambien las dimensiones del catálogo) y no haya que
   * recalcularlo en cada listado.
   */
  async snapshotOrderLoad(orderId: number): Promise<OrderLoad> {
    const load = await this.computeOrderLoad(orderId);
    await this.drizzle.execute(
      `UPDATE shipments
          SET total_volume_cm3 = $2,
              volume_estimated = $3,
              updated_at = now()
        WHERE order_id = $1`,
      [orderId, load.volumeCm3, load.estimated],
    );
    return load;
  }

  /**
   * Cupo comprometido por repartidor. Una sola consulta para toda la flota
   * (evita N+1 al pintar el panel). `driverId` opcional para pedir uno solo.
   */
  private async queryLoads(driverId?: number): Promise<DriverLoad[]> {
    const params: unknown[] = [[...LOAD_STATUSES]];
    let filter = `d.deleted_at IS NULL`;
    if (driverId != null) {
      params.push(driverId);
      filter += ` AND d.id = $2`;
    }

    const rows = await this.drizzle.execute<DriverLoadRow>(
      `SELECT
         d.id                                 AS driver_id,
         d.cargo_volume_cm3                   AS capacity_cm3,
         COALESCE(SUM(s.total_volume_cm3), 0) AS used_cm3,
         COUNT(a.id)                          AS orders,
         COUNT(*) FILTER (WHERE s.volume_estimated) AS estimated_count
       FROM delivery_drivers d
       LEFT JOIN delivery_assignments a
              ON a.driver_id = d.id
             AND a.status::text = ANY($1::text[])
       LEFT JOIN shipments s ON s.id = a.shipment_id
       WHERE ${filter}
       GROUP BY d.id, d.cargo_volume_cm3
       ORDER BY d.id`,
      params,
    );

    return rows.map((row) => {
      const capacityCm3 = row.capacity_cm3 ?? null;
      const usedCm3 = Math.round(Number(row.used_cm3 ?? 0));
      return {
        driverId: Number(row.driver_id),
        capacityCm3,
        usedCm3,
        orders: Number(row.orders ?? 0),
        estimated: Number(row.estimated_count ?? 0) > 0,
        fill: capacityCm3 ? usedCm3 / capacityCm3 : null,
        overloaded: capacityCm3 != null && usedCm3 > capacityCm3,
      };
    });
  }

  /** Cupo comprometido de un repartidor. */
  async getDriverLoad(driverId: number): Promise<DriverLoad> {
    const [load] = await this.queryLoads(driverId);
    return (
      load ?? {
        driverId,
        capacityCm3: null,
        usedCm3: 0,
        orders: 0,
        estimated: false,
        fill: null,
        overloaded: false,
      }
    );
  }

  /** Cupo comprometido de todos los repartidores (panel de flota). */
  async getFleetLoad(): Promise<DriverLoad[]> {
    return this.queryLoads();
  }
}
