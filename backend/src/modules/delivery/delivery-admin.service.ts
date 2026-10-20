import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DrizzleService } from '../../database/drizzle.service';
import {
  branches,
  deliveryAssignments,
  deliveryDrivers,
  shipments,
  userBranches,
  users,
} from '../../../drizzle/schema';
import { parsePoint, DeliveryService } from './delivery.service';
import { DeliveryLoadService } from './delivery-load.service';
import { pickRouteColor } from './driver-colors';
import type { CreateDriverDto, UpdateDriverDto } from './dto/admin-driver.dto';

/** Estados en los que la asignación sigue activa (visible en el panel). */
const ACTIVE_ASSIGNMENT_STATUSES =
  "'ASSIGNED','ACCEPTED','READY_FOR_PICKUP','PICKED_UP','IN_DELIVERY'";

/** Tamaño de página por defecto de la pestaña "Pedidos" (lazyload). */
const ORDERS_PAGE_SIZE = 20;
/** Tope duro de la página (el panel pide lo ya cargado al refrescar en vivo). */
const ORDERS_MAX_PAGE_SIZE = 200;

/**
 * Estados terminales: lo que ya no está en curso y forma parte del historial
 * del repartidor. `FAILED` se incluye por filas antiguas (hoy se usa
 * `FAILED_DELIVERY`).
 */
const HISTORY_ASSIGNMENT_STATUSES =
  "'DELIVERED','FAILED','FAILED_DELIVERY','REJECTED','CANCELLED'";

/**
 * Consulta base de pedidos de la flota. La comparten el listado de pedidos
 * activos y el historial por repartidor, para que devuelvan la misma forma.
 */
const ORDERS_SELECT = `
SELECT
  a.id AS assignment_id, a.driver_id,
  d.full_name AS driver_name, d.vehicle_plate AS driver_plate,
  d.is_available AS driver_available,
  a.status::text AS status,
  a.assigned_at, a.accepted_at, a.ready_for_pickup_at,
  a.picked_up_at, a.in_delivery_at, a.completed_at,
  s.order_id, s.address_line1, s.city, s.location AS destination,
  s.total_volume_cm3, s.volume_estimated,
  o.reference_code, o.customer_name, o.customer_phone,
  o.grand_total, o.currency_code, o.notes,
  b.name AS branch_name, b.address AS branch_address, b.location AS branch_location,
  p.payment_method
FROM delivery_assignments a
JOIN delivery_drivers d ON d.id = a.driver_id
JOIN shipments s ON s.id = a.shipment_id
JOIN orders o ON o.id = s.order_id
LEFT JOIN branches b ON b.id = o.branch_id
LEFT JOIN LATERAL (
  SELECT payment_method FROM payments WHERE order_id = o.id
  ORDER BY created_at DESC LIMIT 1
) p ON true
`;

interface DriverRow {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  route_color: string | null;
  cargo_volume_cm3: number | null;
  is_available: boolean;
  is_active: boolean;
  current_location: string | null;
  last_location_at: string | null;
  last_seen_at: string | null;
  avatar_url: string | null;
  created_at: string;
  auth_user_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  driver_branch_id: string | null;
  driver_branch_name: string | null;
  assignment_id: string | null;
  assignment_status: string | null;
  assigned_at: string | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  in_delivery_at: string | null;
  order_id: string | null;
  reference_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  destination: string | null;
  address_line1: string | null;
  city: string | null;
  branch_name: string | null;
  branch_location: string | null;
}

interface OrderRow {
  assignment_id: string;
  driver_id: string;
  driver_name: string;
  driver_plate: string | null;
  driver_available: boolean;
  status: string;
  assigned_at: string | null;
  accepted_at: string | null;
  ready_for_pickup_at: string | null;
  picked_up_at: string | null;
  in_delivery_at: string | null;
  completed_at: string | null;
  order_id: string;
  reference_code: string;
  customer_name: string | null;
  customer_phone: string | null;
  grand_total: string | null;
  currency_code: string | null;
  notes: string | null;
  address_line1: string | null;
  city: string | null;
  destination: string | null;
  branch_name: string | null;
  branch_address: string | null;
  branch_location: string | null;
  payment_method: string | null;
  /** Snapshot del volumen del pedido en cm³ (null = aún no calculado). */
  total_volume_cm3: number | null;
  volume_estimated: boolean | null;
}

/**
 * Consulta base de la flota: cada repartidor con su cuenta de acceso (users)
 * y su asignación activa (LATERAL: la última no terminada), si tiene.
 */
const DRIVERS_SELECT = `
SELECT
  d.id, d.full_name, d.phone, d.email,
  d.vehicle_type, d.vehicle_plate, d.vehicle_brand, d.vehicle_model, d.vehicle_color,
  d.route_color,
  d.cargo_volume_cm3,
  d.is_available, d.is_active,
  d.current_location, d.last_location_at, d.last_seen_at, d.avatar_url, d.created_at,
  u.id AS auth_user_id, u.username, u.first_name, u.last_name,
  ub.branch_id AS driver_branch_id, br.name AS driver_branch_name,
  a.id AS assignment_id, a.status::text AS assignment_status,
  a.assigned_at, a.accepted_at, a.picked_up_at, a.in_delivery_at,
  s.order_id,
  o.reference_code, o.customer_name, o.customer_phone,
  s.location AS destination, s.address_line1, s.city,
  b.name AS branch_name, b.location AS branch_location
FROM delivery_drivers d
LEFT JOIN users u ON u.id = d.auth_user_id
LEFT JOIN user_branches ub ON ub.user_id = d.auth_user_id
LEFT JOIN branches br ON br.id = ub.branch_id
LEFT JOIN LATERAL (
  SELECT * FROM delivery_assignments
  WHERE driver_id = d.id
    AND status::text IN (${ACTIVE_ASSIGNMENT_STATUSES})
  ORDER BY id DESC
  LIMIT 1
) a ON true
LEFT JOIN shipments s ON s.id = a.shipment_id
LEFT JOIN orders o ON o.id = s.order_id
LEFT JOIN branches b ON b.id = o.branch_id
`;

@Injectable()
export class DeliveryAdminService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly delivery: DeliveryService,
    private readonly loadService: DeliveryLoadService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  private toDriver(row: DriverRow) {
    return {
      id: Number(row.id),
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      username: row.username,
      vehicleType: row.vehicle_type,
      vehiclePlate: row.vehicle_plate,
      vehicleBrand: row.vehicle_brand,
      vehicleModel: row.vehicle_model,
      vehicleColor: row.vehicle_color,
      routeColor: row.route_color,
      // Capacidad declarada del vehículo en cm³ (null = sin declarar).
      cargoVolumeCm3: row.cargo_volume_cm3,
      isAvailable: row.is_available,
      isActive: row.is_active,
      location: parsePoint(row.current_location),
      lastLocationAt: row.last_location_at,
      // Última señal de la app: heartbeat o GPS, lo que sea más reciente (el
      // panel decide conectado/desconectado con esta marca).
      lastSeenAt: row.last_seen_at ?? row.last_location_at,
      avatarUrl: row.avatar_url,
      // Sucursal asignada (una sola); null si el repartidor no tiene sucursal.
      branchId:
        row.driver_branch_id == null ? null : Number(row.driver_branch_id),
      branchName: row.driver_branch_name ?? null,
      createdAt: row.created_at,
      activeAssignment: row.assignment_id
        ? {
            assignmentId: Number(row.assignment_id),
            orderId: Number(row.order_id),
            referenceCode: row.reference_code,
            status: row.assignment_status,
            assignedAt: row.assigned_at,
            acceptedAt: row.accepted_at,
            pickedUpAt: row.picked_up_at,
            inDeliveryAt: row.in_delivery_at,
            customerName: row.customer_name,
            customerPhone: row.customer_phone,
            destination: parsePoint(row.destination),
            addressLine1: row.address_line1,
            city: row.city,
            branchName: row.branch_name,
            branchLocation: parsePoint(row.branch_location),
          }
        : null,
    };
  }

  /** Lista la flota completa (repartidores no eliminados) con estado en vivo. */
  async listDrivers(branchId?: number | null) {
    const params: unknown[] = [];
    const conds: string[] = ['d.deleted_at IS NULL'];
    // Filtro por sucursal del repartidor (user_branches de su cuenta de acceso).
    if (branchId != null) {
      params.push(branchId);
      conds.push(`ub.branch_id = $${params.length}`);
    }
    const rows = await this.drizzle.execute<DriverRow>(
      `${DRIVERS_SELECT}
       WHERE ${conds.join(' AND ')}
       ORDER BY d.id ASC`,
      params,
    );
    // Cupo comprometido de toda la flota en una sola consulta.
    const loads = new Map(
      (await this.loadService.getFleetLoad()).map((l) => [l.driverId, l]),
    );
    return rows.map((r) => {
      const driver = this.toDriver(r);
      return { ...driver, load: loads.get(driver.id) ?? null };
    });
  }

  async getDriver(id: number) {
    const rows = await this.drizzle.execute<DriverRow>(
      `${DRIVERS_SELECT}
       WHERE d.deleted_at IS NULL AND d.id = $1
       LIMIT 1`,
      [id],
    );
    if (!rows.length) {
      throw new NotFoundException(`Repartidor ${id} no encontrado.`);
    }
    const driver = this.toDriver(rows[0]);
    return { ...driver, load: await this.loadService.getDriverLoad(driver.id) };
  }

  /**
   * Ruta por calles (OSRM) de un pedido para el mapa de flota.
   * `target` = 'store' (tienda a recoger) | 'customer' (domicilio).
   * El origen puede venir en `from` (`lng,lat`); si no, se usa la posición del
   * repartidor asignado. La ruta se calcula antes de pintarse.
   */
  async getOrderRoute(
    orderId: number,
    target: 'customer' | 'store' = 'customer',
    from?: string,
  ) {
    let driver: typeof deliveryDrivers.$inferSelect | null = null;
    if (!from) {
      const [assignment] = await this.db
        .select({ driverId: deliveryAssignments.driverId })
        .from(deliveryAssignments)
        .innerJoin(shipments, eq(shipments.id, deliveryAssignments.shipmentId))
        .where(eq(shipments.orderId, orderId))
        .orderBy(desc(deliveryAssignments.id))
        .limit(1);
      if (assignment?.driverId != null) {
        driver = await this.findDriverRow(Number(assignment.driverId));
      } else {
        throw new UnprocessableEntityException(
          'El pedido no tiene un repartidor asignado.',
        );
      }
    }
    return this.delivery.getOrderRoute(driver, orderId, from, target);
  }

  private async findDriverRow(id: number) {
    const rows = await this.db
      .select()
      .from(deliveryDrivers)
      .where(
        and(
          eq(deliveryDrivers.id, BigInt(id)),
          isNull(deliveryDrivers.deletedAt),
        ),
      )
      .limit(1);
    if (!rows.length) {
      throw new NotFoundException(`Repartidor ${id} no encontrado.`);
    }
    return rows[0];
  }

  /**
   * Asigna (o quita) la sucursal única de la cuenta de acceso del repartidor.
   * Se guarda en `user_branches`, la misma tabla que usan los usuarios de
   * picking: un usuario pertenece a una sola sucursal.
   */
  private async setBranch(userId: number, branchId: number | null) {
    await this.db.delete(userBranches).where(eq(userBranches.userId, userId));
    if (branchId != null) {
      const [branch] = await this.db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.id, BigInt(branchId)))
        .limit(1);
      if (!branch) throw new BadRequestException('La sucursal no existe.');
      await this.db.insert(userBranches).values({ userId, branchId });
    }
  }

  /** Sucursal (branchId) de un repartidor, o `null` si no tiene asignada. */
  async driverBranch(driverId: number): Promise<number | null> {
    const rows = await this.drizzle.execute<{ branch_id: string | null }>(
      `SELECT ub.branch_id
       FROM delivery_drivers d
       LEFT JOIN user_branches ub ON ub.user_id = d.auth_user_id
       WHERE d.id = $1
       LIMIT 1`,
      [driverId],
    );
    const b = rows[0]?.branch_id;
    return b == null ? null : Number(b);
  }

  /** Sucursales activas para el selector del panel (scope ya lo filtra). */
  async branches() {
    const rows = await this.db
      .select({
        id: branches.id,
        code: branches.code,
        name: branches.name,
        city: branches.city,
      })
      .from(branches)
      .where(and(isNull(branches.deletedAt), eq(branches.isActive, true)))
      .orderBy(asc(branches.priority), asc(branches.name));

    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      name: r.name,
      city: r.city,
    }));
  }

  /**
   * Crea la cuenta de acceso (users) y el perfil de repartidor en una
   * transacción. El login en la app móvil es /delivery/auth/login con el
   * username/contraseña definidos aquí.
   */
  async createDriver(dto: CreateDriverDto) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();

    const existing = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, email), eq(users.username, username)))
      .limit(1);
    if (existing.length) {
      throw new ConflictException(
        'Ya existe un usuario con ese email o nombre de usuario.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const nameParts = dto.fullName.trim().split(/\s+/);
    const firstName = dto.firstName?.trim() || nameParts[0] || 'Repartidor';
    const lastName = dto.lastName?.trim() || nameParts.slice(1).join(' ') || '';

    // Color de ruta por defecto: aleatorio entre los que aún no se usan.
    const usedColors = (
      await this.db
        .select({ routeColor: deliveryDrivers.routeColor })
        .from(deliveryDrivers)
        .where(isNull(deliveryDrivers.deletedAt))
    )
      .map((r) => r.routeColor)
      .filter((c): c is string => Boolean(c));
    const routeColor = pickRouteColor(usedColors);

    const created = await this.drizzle.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          username,
          passwordHash,
          firstName,
          lastName,
          phone: dto.phone.trim(),
          isSuperuser: false,
          isActive: true,
        })
        .returning({ id: users.id });

      const [driver] = await tx
        .insert(deliveryDrivers)
        .values({
          fullName: dto.fullName.trim(),
          phone: dto.phone.trim(),
          email,
          authUserId: Number(user.id),
          vehicleType: dto.vehicleType?.trim() || null,
          vehiclePlate: dto.vehiclePlate?.trim() || null,
          vehicleBrand: dto.vehicleBrand?.trim() || null,
          vehicleModel: dto.vehicleModel?.trim() || null,
          vehicleColor: dto.vehicleColor?.trim() || null,
          routeColor,
          cargoVolumeCm3: dto.cargoVolumeCm3 ?? null,
          isAvailable: true,
          isActive: true,
        })
        .returning({ id: deliveryDrivers.id });

      return { driverId: Number(driver.id), authUserId: Number(user.id) };
    });

    // Sucursal única de la cuenta de acceso (user_branches).
    await this.setBranch(created.authUserId, dto.branchId ?? null);

    return this.getDriver(created.driverId);
  }

  async updateDriver(id: number, dto: UpdateDriverDto) {
    const driver = await this.findDriverRow(id);

    if (dto.username !== undefined && driver.authUserId != null) {
      // Verificar que ningún OTRO usuario use ese username.
      const username = dto.username.trim();
      const taken = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      if (taken.length && taken[0].id !== BigInt(driver.authUserId)) {
        throw new ConflictException('Ese nombre de usuario ya está en uso.');
      }
    }

    const patch: Partial<typeof deliveryDrivers.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (dto.fullName !== undefined) patch.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) patch.phone = dto.phone.trim();
    if (dto.email !== undefined) patch.email = dto.email.trim().toLowerCase();
    if (dto.vehicleType !== undefined)
      patch.vehicleType = dto.vehicleType.trim() || null;
    if (dto.vehiclePlate !== undefined)
      patch.vehiclePlate = dto.vehiclePlate.trim() || null;
    if (dto.vehicleBrand !== undefined)
      patch.vehicleBrand = dto.vehicleBrand.trim() || null;
    if (dto.vehicleModel !== undefined)
      patch.vehicleModel = dto.vehicleModel.trim() || null;
    if (dto.vehicleColor !== undefined)
      patch.vehicleColor = dto.vehicleColor.trim() || null;
    if (dto.routeColor !== undefined)
      patch.routeColor = dto.routeColor.trim().toUpperCase();
    // `null` explícito borra la capacidad; omitirla no la toca.
    if (dto.cargoVolumeCm3 !== undefined)
      patch.cargoVolumeCm3 = dto.cargoVolumeCm3;
    if (dto.isAvailable !== undefined) patch.isAvailable = dto.isAvailable;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    await this.db
      .update(deliveryDrivers)
      .set(patch)
      .where(eq(deliveryDrivers.id, BigInt(id)));

    // Sincroniza los datos de la cuenta de acceso (username/nombres).
    if (driver.authUserId != null) {
      const userPatch: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date().toISOString(),
      };
      if (dto.username !== undefined) userPatch.username = dto.username.trim();
      if (dto.firstName !== undefined)
        userPatch.firstName = dto.firstName.trim();
      if (dto.lastName !== undefined) userPatch.lastName = dto.lastName.trim();
      if (Object.keys(userPatch).length > 1) {
        await this.db
          .update(users)
          .set(userPatch)
          .where(eq(users.id, BigInt(driver.authUserId)));
      }
    }

    // Sucursal única: si viene en el DTO se reemplaza (null la quita).
    if (dto.branchId !== undefined && driver.authUserId != null) {
      await this.setBranch(Number(driver.authUserId), dto.branchId);
    }

    return this.getDriver(id);
  }

  async resetPassword(id: number, password: string) {
    const driver = await this.findDriverRow(id);
    if (driver.authUserId == null) {
      throw new BadRequestException(
        'Este repartidor no tiene una cuenta de acceso asociada.',
      );
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.db
      .update(users)
      .set({
        passwordHash,
        lockedUntil: null,
        failedAttempts: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, BigInt(driver.authUserId)));
    return { success: true };
  }

  /**
   * Pedidos de la flota para la pestaña "Pedidos": todos los estados (activos
   * e históricos: entregados, fallidos, cancelados…), paginados para cargar de
   * a poco. `status` filtra por estado y `q` busca por código, repartidor,
   * cliente o dirección.
   */
  async listOrders(
    opts: {
      limit?: number;
      offset?: number;
      status?: string;
      q?: string;
      branchId?: number | null;
    } = {},
  ) {
    const limit = Math.min(
      Math.max(Number(opts.limit) || ORDERS_PAGE_SIZE, 1),
      ORDERS_MAX_PAGE_SIZE,
    );
    const offset = Math.max(Number(opts.offset) || 0, 0);

    const conds: string[] = ['d.deleted_at IS NULL'];
    const params: unknown[] = [];

    // Filtro por sucursal del pedido (el admin de sucursal queda forzado aquí).
    if (opts.branchId != null) {
      params.push(opts.branchId);
      conds.push(`o.branch_id = $${params.length}`);
    }

    const status = (opts.status ?? '').trim().toUpperCase();
    if (status && status !== 'ALL') {
      params.push(status);
      conds.push(`a.status::text = $${params.length}`);
    }

    const q = (opts.q ?? '').trim();
    if (q) {
      // Escapa los comodines para que el texto del usuario se busque literal.
      params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const p = `$${params.length}`;
      conds.push(
        `(o.reference_code ILIKE ${p} OR d.full_name ILIKE ${p} OR o.customer_name ILIKE ${p} OR s.address_line1 ILIKE ${p})`,
      );
    }

    const where = conds.join(' AND ');

    const [countRows, rows] = await Promise.all([
      this.drizzle.execute<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM delivery_assignments a
         JOIN delivery_drivers d ON d.id = a.driver_id
         JOIN shipments s ON s.id = a.shipment_id
         JOIN orders o ON o.id = s.order_id
         WHERE ${where}`,
        params,
      ),
      this.drizzle.execute<OrderRow>(
        `${ORDERS_SELECT}
         WHERE ${where}
         ORDER BY a.assigned_at DESC NULLS LAST, a.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: rows.map((r) => this.toOrder(r)),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }

  /**
   * Historial de un repartidor: sus asignaciones ya cerradas (entregadas,
   * fallidas, rechazadas o canceladas), de la más reciente a la más antigua.
   */
  async listDriverHistory(driverId: number, limit = 50) {
    const rows = await this.drizzle.execute<OrderRow>(
      `${ORDERS_SELECT}
       WHERE a.driver_id = $1
         AND a.status::text IN (${HISTORY_ASSIGNMENT_STATUSES})
       ORDER BY a.completed_at DESC NULLS LAST, a.id DESC
       LIMIT $2`,
      [driverId, limit],
    );
    return rows.map((r) => this.toOrder(r));
  }

  /** Fila de pedido → objeto que consume el panel. */
  private toOrder(r: OrderRow) {
    return {
      assignmentId: Number(r.assignment_id),
      driverId: Number(r.driver_id),
      driverName: r.driver_name,
      driverPlate: r.driver_plate,
      driverAvailable: r.driver_available,
      orderId: Number(r.order_id),
      referenceCode: r.reference_code,
      status: r.status,
      assignedAt: r.assigned_at,
      acceptedAt: r.accepted_at,
      readyForPickupAt: r.ready_for_pickup_at,
      pickedUpAt: r.picked_up_at,
      inDeliveryAt: r.in_delivery_at,
      completedAt: r.completed_at,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      addressLine1: r.address_line1,
      city: r.city,
      notes: r.notes,
      destination: parsePoint(r.destination),
      branchName: r.branch_name,
      branchAddress: r.branch_address,
      branchLocation: parsePoint(r.branch_location),
      // Volumen del pedido (cm³) y si es aproximado por falta de dimensiones.
      volume: {
        cm3: r.total_volume_cm3 ?? null,
        estimated: Boolean(r.volume_estimated),
      },
      totals: {
        value: Number(r.grand_total ?? 0),
        currency: r.currency_code ?? 'COP',
      },
      payment: {
        method: r.payment_method ?? 'CASH',
        label: r.payment_method === 'CASH' ? 'Contraentrega' : 'Pagado',
      },
    };
  }
}
