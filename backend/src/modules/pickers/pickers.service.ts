import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  orders,
  orderStatusHistory,
  orderItems,
  users,
} from '../../../drizzle/schema';

/** Estados en los que un pedido cuenta como "en alistamiento". */
const ACTIVE_STATUSES = ['paid', 'preparing'] as const;

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

  /** Usuarios disponibles para picking (activos, sin borrar). */
  async list() {
    const rows = await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        username: users.username,
        phone: users.phone,
      })
      .from(users)
      .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.firstName), asc(users.lastName));

    return rows.map((u) => ({
      id: Number(u.id),
      name: this.nameOf(u),
      email: u.email,
      username: u.username,
      phone: u.phone,
    }));
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
      })
      .from(orders)
      .where(
        and(
          inArray(orders.pickerId, ids),
          inArray(orders.status, [...ACTIVE_STATUSES]),
        ),
      )
      .orderBy(desc(orders.pickedAt), desc(orders.id));

    // Mapa pickerId -> pedido actual (el más reciente de cada picker)
    const currentByPicker = new Map<number, (typeof currentRows)[number]>();
    for (const row of currentRows) {
      const pid = Number(row.pickerId);
      if (!currentByPicker.has(pid)) currentByPicker.set(pid, row);
    }

    // Entregados hoy por picker
    const todayRows = await this.db
      .select({
        pickerId: orderStatusHistory.pickerId,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(orderStatusHistory)
      .where(
        and(
          inArray(orderStatusHistory.pickerId, ids),
          eq(orderStatusHistory.status, 'delivered'),
          sql`${orderStatusHistory.createdAt}::date = CURRENT_DATE`,
        ),
      )
      .groupBy(orderStatusHistory.pickerId);
    const todayByPicker = new Map(todayRows.map((r) => [Number(r.pickerId), r.n]));

    // Total despachado por picker
    const totalRows = await this.db
      .select({
        pickerId: orderStatusHistory.pickerId,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(orderStatusHistory)
      .where(
        and(
          inArray(orderStatusHistory.pickerId, ids),
          eq(orderStatusHistory.status, 'delivered'),
        ),
      )
      .groupBy(orderStatusHistory.pickerId);
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
            }
          : null,
        completedToday: todayByPicker.get(p.id) ?? 0,
        dispatchedTotal: totalByPicker.get(p.id) ?? 0,
      };
    });
  }

  /** Historial completo de pedidos despachados por un picker. */
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
        deliveredAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .innerJoin(orders, eq(orders.id, orderStatusHistory.orderId))
      .where(
        and(
          eq(orderStatusHistory.pickerId, pickerId),
          eq(orderStatusHistory.status, 'delivered'),
        ),
      )
      .orderBy(desc(orderStatusHistory.createdAt))
      .limit(300);

    const orderIds = rows.map((r) => Number(r.id));
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

    return {
      picker: { id: pickerId, name: this.nameOf(user) },
      orders: rows.map((r) => {
        const agg = aggByOrder.get(Number(r.id)) ?? { items: 0, pieces: 0, scanned: 0 };
        return {
          id: Number(r.id),
          referenceCode: r.referenceCode,
          customerName: r.customerName ?? 'Cliente',
          grandTotal: Number(r.grandTotal),
          status: r.status,
          deliveredAt: r.deliveredAt,
          itemsCount: agg.items,
          totalPieces: agg.pieces,
          scannedPieces: agg.scanned,
        };
      }),
    };
  }
}
