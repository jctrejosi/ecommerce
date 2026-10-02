import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DrizzleService } from '../../database/drizzle.service';
import {
  orders,
  orderStatusHistory,
  orderItems,
  users,
} from '../../../drizzle/schema';

/**
 * Estados en los que un pedido cuenta como "en alistamiento".
 * `ready` sigue contando hasta que el picker cierre en caja (`completed_at`).
 */
const ACTIVE_STATUSES = ['paid', 'preparing', 'ready'] as const;

@Injectable()
export class PickersService {
  private readonly logger = new Logger(PickersService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  private nameOf(u: { firstName: string; lastName: string }): string {
    return `${u.firstName} ${u.lastName}`.trim();
  }

  /**
   * Usuarios que pueden iniciar sesión en la app de picking: activos, sin
   * borrar y marcados explícitamente como pickers desde el panel.
   */
  async list() {
    const rows = await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        username: users.username,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          eq(users.isPicker, true),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(asc(users.firstName), asc(users.lastName));

    return rows.map((u) => ({
      id: Number(u.id),
      name: this.nameOf(u),
      email: u.email,
      username: u.username,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
    }));
  }

  /** Columnas que devuelve la gestión de usuarios del panel. */
  private readonly pickerColumns = {
    id: users.id,
    firstName: users.firstName,
    lastName: users.lastName,
    email: users.email,
    username: users.username,
    phone: users.phone,
    avatarUrl: users.avatarUrl,
    isActive: users.isActive,
    isSuperuser: users.isSuperuser,
    isPicker: users.isPicker,
  };

  private toPicker(u: {
    id: bigint;
    firstName: string;
    lastName: string;
    email: string;
    username: string;
    phone: string | null;
    avatarUrl: string | null;
    isActive: boolean;
    isSuperuser: boolean;
    isPicker: boolean;
  }) {
    return {
      id: Number(u.id),
      name: this.nameOf(u),
      email: u.email,
      username: u.username,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
      isActive: u.isActive,
      isSuperuser: u.isSuperuser,
      isPicker: u.isPicker,
    };
  }

  // ─── Perfil del propio picker (app móvil) ──────────────────────────────────

  /**
   * Guarda la URL pública de la foto de perfil del usuario.
   *
   * El archivo lo sube antes el controlador a Cloudinary; aquí solo se persiste
   * la URL (la misma que ve el panel de picking admin).
   */
  async setAvatarUrl(userId: number, avatarUrl: string) {
    await this.db
      .update(users)
      .set({ avatarUrl, updatedAt: new Date().toISOString() })
      .where(eq(users.id, BigInt(userId)));
    return { ok: true, avatarUrl };
  }

  /**
   * Guarda el token FCM del dispositivo del picker.
   *
   * Lo registra la app al iniciar sesión; es el destino de los push de pedido
   * nuevo y de mensajes del chat de administración.
   */
  async setPushToken(userId: number, token: string) {
    await this.db
      .update(users)
      .set({ pushToken: token, updatedAt: new Date().toISOString() })
      .where(eq(users.id, BigInt(userId)));
    return { ok: true };
  }

  /**
   * Cambia la contraseña del propio usuario.
   *
   * Exige la actual: el dispositivo queda en la bodega y sin ese control
   * cualquiera podría cambiarla desde la app abierta.
   */
  async changeOwnPassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ) {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, BigInt(userId)))
      .limit(1);
    if (!user) throw new NotFoundException(`Usuario ${userId} no encontrado`);

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(users.id, BigInt(userId)));

    return { success: true };
  }

  /** Todos los usuarios (incluye inactivos) para la gestión desde el panel. */
  async listAll() {
    const rows = await this.db
      .select(this.pickerColumns)
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.firstName), asc(users.lastName));

    return rows.map((u) => this.toPicker(u));
  }

  private async findRow(id: number) {
    const rows = await this.db
      .select(this.pickerColumns)
      .from(users)
      .where(and(eq(users.id, BigInt(id)), isNull(users.deletedAt)))
      .limit(1);
    if (!rows.length) throw new NotFoundException('Usuario no encontrado');
    return rows[0];
  }

  /** Crea una cuenta de acceso a la app móvil de picking. */
  async create(dto: {
    fullName: string;
    username: string;
    email: string;
    phone?: string;
    password: string;
  }) {
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
    const parts = dto.fullName.trim().split(/\s+/);
    const [row] = await this.db
      .insert(users)
      .values({
        email,
        username,
        passwordHash,
        firstName: parts[0] || dto.fullName.trim(),
        lastName: parts.slice(1).join(' '),
        phone: dto.phone?.trim() || null,
        isSuperuser: false,
        isActive: true,
        // Los usuarios creados desde el panel nacen como pickers.
        isPicker: true,
      })
      .returning(this.pickerColumns);

    this.logger.log(`Usuario de picking creado: ${username}`);
    return this.toPicker(row);
  }

  /** Actualiza los datos de un usuario de picking. */
  async update(
    id: number,
    dto: {
      fullName?: string;
      username?: string;
      email?: string;
      phone?: string;
      isActive?: boolean;
      isPicker?: boolean;
    },
    actingUserId?: number,
  ) {
    const target = await this.findRow(id);

    // Desactivar puede dejar el sistema sin administrador o bloquear al propio
    // admin que lo intenta; ambas cosas se rechazan.
    if (dto.isActive === false) {
      await this.assertCanDeactivate(target, id, actingUserId);
    }

    const email = dto.email?.trim().toLowerCase();
    const username = dto.username?.trim();
    if (email || username) {
      const conflicts: SQL[] = [];
      if (email) conflicts.push(eq(users.email, email));
      if (username) conflicts.push(eq(users.username, username));
      const dup = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(or(...conflicts), ne(users.id, BigInt(id))))
        .limit(1);
      if (dup.length) {
        throw new ConflictException(
          'Ya existe otro usuario con ese email o nombre de usuario.',
        );
      }
    }

    const patch: Partial<typeof users.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (dto.fullName !== undefined) {
      const parts = dto.fullName.trim().split(/\s+/);
      patch.firstName = parts[0] || dto.fullName.trim();
      patch.lastName = parts.slice(1).join(' ');
    }
    if (username !== undefined) patch.username = username;
    if (email !== undefined) patch.email = email;
    if (dto.phone !== undefined) patch.phone = dto.phone.trim() || null;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.isPicker !== undefined) patch.isPicker = dto.isPicker;

    const [row] = await this.db
      .update(users)
      .set(patch)
      .where(eq(users.id, BigInt(id)))
      .returning(this.pickerColumns);

    return this.toPicker(row);
  }

  /**
   * Impide desactivar al último superusuario activo (dejaría el sistema sin
   * administrador) y la propia cuenta del administrador que lo intenta.
   */
  private async assertCanDeactivate(
    target: { isSuperuser: boolean },
    id: number,
    actingUserId?: number,
  ) {
    if (target.isSuperuser) {
      const active = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.isSuperuser, true),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        )
        .limit(2);
      if (active.length <= 1) {
        throw new ConflictException(
          'No puedes desactivar al último superusuario activo: el sistema se quedaría sin administrador.',
        );
      }
    }
    if (actingUserId !== undefined && actingUserId === id) {
      throw new ConflictException(
        'No puedes desactivar tu propia cuenta mientras estás conectado.',
      );
    }
  }

  /** Restablece la contraseña y desbloquea la cuenta. */
  async resetPassword(id: number, password: string) {
    await this.findRow(id);
    const passwordHash = await bcrypt.hash(password, 10);
    await this.db
      .update(users)
      .set({
        passwordHash,
        lockedUntil: null,
        failedAttempts: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, BigInt(id)));
    return { success: true };
  }

  /**
   * Métricas de todos los pickers en 3 consultas (sin N+1):
   *  - pedido actual (paid/preparing) por picker
   *  - entregados hoy por picker
   *  - total despachado por picker
   */
  async metrics() {
    const pickers = await this.list();
    if (pickers.length === 0) return [];

    const ids = pickers.map((p) => p.id);

    // Pedido actual por picker
    const currentRows = await this.db
      .select({
        pickerId: orders.pickerId,
        id: orders.id,
        referenceCode: orders.referenceCode,
        customerName: orders.customerName,
        status: orders.status,
        pickedAt: orders.pickedAt,
        items: sql<number>`(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = orders.id)`,
        pieces: sql<number>`(SELECT COALESCE(SUM(oi.quantity),0)::int FROM order_items oi WHERE oi.order_id = orders.id)`,
        scanned: sql<number>`(SELECT COALESCE(SUM(oi.picked_qty),0)::int FROM order_items oi WHERE oi.order_id = orders.id)`,
        remainingItems: sql<number>`(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = orders.id AND oi.picked_qty < oi.quantity)`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.pickerId, ids),
          inArray(orders.status, [...ACTIVE_STATUSES]),
          isNull(orders.completedAt),
        ),
      )
      .orderBy(desc(orders.pickedAt), desc(orders.id));

    // Mapa pickerId -> pedido actual (el más reciente de cada picker)
    const currentByPicker = new Map<number, (typeof currentRows)[number]>();
    for (const row of currentRows) {
      const pid = Number(row.pickerId);
      if (!currentByPicker.has(pid)) currentByPicker.set(pid, row);
    }

    // Entregados hoy por picker: pedidos que el picker cerró en caja hoy.
    const todayRows = await this.db
      .select({
        pickerId: orders.pickerId,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.pickerId, ids),
          isNotNull(orders.completedAt),
          sql`${orders.completedAt}::date = CURRENT_DATE`,
        ),
      )
      .groupBy(orders.pickerId);
    const todayByPicker = new Map(todayRows.map((r) => [Number(r.pickerId), r.n]));

    // Total despachado por picker.
    const totalRows = await this.db
      .select({
        pickerId: orders.pickerId,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.pickerId, ids),
          isNotNull(orders.completedAt),
        ),
      )
      .groupBy(orders.pickerId);
    const totalByPicker = new Map(totalRows.map((r) => [Number(r.pickerId), r.n]));

    return pickers.map((p) => {
      const cur = currentByPicker.get(p.id);
      return {
        ...p,
        currentOrder: cur
          ? {
              id: Number(cur.id),
              referenceCode: cur.referenceCode,
              customerName: cur.customerName ?? 'Cliente',
              status: cur.status,
              pickedAt: cur.pickedAt,
              itemsCount: cur.items,
              totalPieces: cur.pieces,
              scannedPieces: cur.scanned,
              remainingPieces: Math.max(0, cur.pieces - cur.scanned),
              remainingItems: cur.remainingItems,
            }
          : null,
        completedToday: todayByPicker.get(p.id) ?? 0,
        dispatchedTotal: totalByPicker.get(p.id) ?? 0,
      };
    });
  }

  /**
   * Pedidos para el tab "Pedidos" del panel, filtrables por sucursal.
   *
   * `branchId` es opcional: sin él se listan los de todas las sucursales (el
   * panel siempre manda la seleccionada). Los agregados de items van como
   * subconsultas para poder paginar sin una consulta por pedido.
   */
  async orderList(params: {
    branchId?: number;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 300);
    const offset = Math.max(params.offset ?? 0, 0);

    // Filtros de "universo" (sucursal + búsqueda): los usan la lista y los conteos.
    const base: SQL[] = [];
    if (params.branchId !== undefined) {
      base.push(eq(orders.branchId, params.branchId));
    }
    const search = params.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      const searchCond = or(
        like(orders.referenceCode, pattern),
        like(orders.customerName, pattern),
        like(orders.customerPhone, pattern),
      );
      if (searchCond) base.push(searchCond);
    }

    // Estado: solo se acepta si está en el enum (evita romper la consulta).
    const statusParam = params.status?.trim();
    const statusCond =
      statusParam &&
      (orders.status.enumValues as readonly string[]).includes(statusParam)
        ? eq(
            orders.status,
            statusParam as (typeof orders.status.enumValues)[number],
          )
        : undefined;

    const where = statusCond
      ? and(...base, statusCond)
      : base.length > 0
        ? and(...base)
        : undefined;

    const rows = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        status: orders.status,
        grandTotal: orders.grandTotal,
        createdAt: orders.createdAt,
        pickerId: orders.pickerId,
        pickerName: sql<string | null>`NULLIF(TRIM(CONCAT(${users.firstName}, ' ', ${users.lastName})), '')`,
        pickedAt: orders.pickedAt,
        completedAt: orders.completedAt,
        deliveredAt: sql<string | null>`(SELECT MAX(osh.created_at) FROM order_status_history osh WHERE osh.order_id = ${orders.id} AND osh.status = 'delivered')`,
        itemsCount: sql<number>`(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = ${orders.id})`,
        totalPieces: sql<number>`(SELECT COALESCE(SUM(oi.quantity),0)::int FROM order_items oi WHERE oi.order_id = ${orders.id})`,
        scannedPieces: sql<number>`(SELECT COALESCE(SUM(oi.picked_qty),0)::int FROM order_items oi WHERE oi.order_id = ${orders.id})`,
        remainingItems: sql<number>`(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = ${orders.id} AND oi.picked_qty < oi.quantity)`,
      })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.pickerId))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset(offset);

    // Conteos por estado del universo actual (sin el filtro de estado): alimentan
    // los chips de filtro y el total paginado.
    const countRows = await this.db
      .select({ status: orders.status, n: sql<number>`COUNT(*)::int` })
      .from(orders)
      .where(base.length > 0 ? and(...base) : undefined)
      .groupBy(orders.status);
    const countByStatus = new Map(countRows.map((r) => [r.status, r.n]));
    const counts = Object.fromEntries(
      orders.status.enumValues.map((s) => [s, countByStatus.get(s) ?? 0]),
    ) as Record<(typeof orders.status.enumValues)[number], number>;
    const total = statusCond
      ? (countByStatus.get(
          statusParam as (typeof orders.status.enumValues)[number],
        ) ?? 0)
      : Object.values(counts).reduce((acc, n) => acc + n, 0);

    return {
      branchId: params.branchId ?? null,
      total,
      counts,
      limit,
      offset,
      orders: rows.map((r) => ({
        id: Number(r.id),
        referenceCode: r.referenceCode,
        customerName: r.customerName ?? 'Cliente',
        customerPhone: r.customerPhone,
        status: r.status,
        grandTotal: Number(r.grandTotal),
        createdAt: r.createdAt,
        pickerId: r.pickerId === null ? null : Number(r.pickerId),
        pickerName: r.pickerName,
        pickedAt: r.pickedAt,
        completedAt: r.completedAt,
        deliveredAt: r.deliveredAt,
        itemsCount: r.itemsCount,
        totalPieces: r.totalPieces,
        scannedPieces: r.scannedPieces,
        remainingPieces: Math.max(0, r.totalPieces - r.scannedPieces),
        remainingItems: r.remainingItems,
      })),
    };
  }

  /** Historial completo de pedidos alistados por un picker (cierre en caja). */
  async history(pickerId: number) {
    const [user] = await this.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, BigInt(pickerId)))
      .limit(1);
    if (!user) throw new NotFoundException(`Usuario ${pickerId} no encontrado`);

    const rows = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        customerName: orders.customerName,
        grandTotal: orders.grandTotal,
        status: orders.status,
        pickedAt: orders.pickedAt,
        completedAt: orders.completedAt,
      })
      .from(orders)
      .where(and(eq(orders.pickerId, pickerId), isNotNull(orders.completedAt)))
      .orderBy(desc(orders.completedAt))
      .limit(300);

    const orderIds = rows.map((r) => Number(r.id));

    // Agregado de items/piezas escaneadas por pedido.
    const aggByOrder = new Map<number, { items: number; pieces: number; scanned: number }>();
    if (orderIds.length > 0) {
      const agg = await this.db
        .select({
          orderId: orderItems.orderId,
          items: sql<number>`COUNT(*)::int`,
          pieces: sql<number>`COALESCE(SUM(${orderItems.quantity}),0)::int`,
          scanned: sql<number>`COALESCE(SUM(${orderItems.pickedQty}),0)::int`,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))
        .groupBy(orderItems.orderId);
      for (const a of agg) {
        aggByOrder.set(Number(a.orderId), {
          items: a.items,
          pieces: a.pieces,
          scanned: a.scanned,
        });
      }
    }

    // Entrega real al cliente (la marca el repartidor, sin picker asociado).
    const deliveredByOrder = new Map<number, string>();
    if (orderIds.length > 0) {
      const deliveredRows = await this.db
        .select({
          orderId: orderStatusHistory.orderId,
          at: orderStatusHistory.createdAt,
        })
        .from(orderStatusHistory)
        .where(
          and(
            inArray(orderStatusHistory.orderId, orderIds),
            eq(orderStatusHistory.status, 'delivered'),
          ),
        )
        .orderBy(desc(orderStatusHistory.createdAt));
      for (const d of deliveredRows) {
        const oid = Number(d.orderId);
        if (d.at && !deliveredByOrder.has(oid)) deliveredByOrder.set(oid, d.at);
      }
    }

    return {
      picker: { id: pickerId, name: this.nameOf(user) },
      orders: rows.map((r) => {
        const oid = Number(r.id);
        const agg = aggByOrder.get(oid) ?? { items: 0, pieces: 0, scanned: 0 };
        return {
          id: oid,
          referenceCode: r.referenceCode,
          customerName: r.customerName ?? 'Cliente',
          grandTotal: Number(r.grandTotal),
          status: r.status,
          pickedAt: r.pickedAt,
          completedAt: r.completedAt,
          deliveredAt: deliveredByOrder.get(oid) ?? null,
          itemsCount: agg.items,
          totalPieces: agg.pieces,
          scannedPieces: agg.scanned,
        };
      }),
    };
  }
}
