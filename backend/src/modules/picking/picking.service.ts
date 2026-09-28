import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { PickingGateway } from './picking.gateway';
import { OrdersGateway } from '../orders/orders.gateway';
import { DeliveryOrdersService } from '../delivery/delivery-orders.service';
import { DeliveryLoadService } from '../delivery/delivery-load.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  orderItems,
  orders,
  orderStatusHistory,
  productVariants,
  products,
  users,
  media,
  productImages,
  productLocations,
  shelves,
} from '../../../drizzle/schema';

/** Estados que pertenecen a la cola de picking. */
const QUEUE_STATUSES = [
  'created',
  'payment_pending',
  'paid',
  'preparing',
  'ready',
  'shipped',
  'delivered',
] as const;

/** Estados que pasan a "preparing" al reclamar o escanear el pedido. */
const PICKING_TRIGGER_STATUSES = ['created', 'payment_pending', 'paid'] as const;

/** El pedido ya salió de alistamiento: no se vuelve a marcar como "listo". */
const PICKED_DONE_STATUSES = ['ready', 'shipped', 'delivered'] as const;

function isPickingTrigger(status: string): boolean {
  return (PICKING_TRIGGER_STATUSES as readonly string[]).includes(status);
}

function isPickedDone(status: string): boolean {
  return (PICKED_DONE_STATUSES as readonly string[]).includes(status);
}

type QueueTab = 'nuevo' | 'preparando' | 'completado' | 'todos';

@Injectable()
export class PickingService {
  private readonly logger = new Logger(PickingService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly gateway: PickingGateway,
    private readonly ordersGateway: OrdersGateway,
    private readonly deliveryOrders: DeliveryOrdersService,
    private readonly deliveryLoad: DeliveryLoadService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  /**
   * Avisa al cliente que su pedido entró a alistamiento: estado en vivo por
   * WebSocket + notificación persistida.
   *
   * El channel del WebSocket es `order:<referenceCode>` (es el identificador
   * con el que se suscribe el cliente en `useOrderSocket`), y el estado que
   * consume la UI ya viene normalizado (`preparando`, no `preparing`).
   */
  private async notifyPreparing(order: {
    referenceCode: string | null;
    customerId: number | null;
  }) {
    if (!order.referenceCode) return;
    this.ordersGateway.notifyOrderStatus(order.referenceCode, 'preparando', {
      customerId: order.customerId,
    });

    if (order.customerId == null) return;
    await this.notifications.create({
      type: 'ORDER',
      title: 'Estamos preparando tu pedido 🛒',
      message: `Tu pedido ${order.referenceCode} entró a alistamiento. Te avisaremos cuando salga a entrega.`,
      targetCustomerId: Number(order.customerId),
      linkUrl: '/account?tab=orders',
    });
  }

  /**
   * Avisa al cliente que su pedido quedó listo (todos los items alistados):
   * estado en vivo por WebSocket + notificación persistida.
   */
  private async notifyReady(order: {
    referenceCode: string | null;
    customerId: number | null;
  }) {
    if (!order.referenceCode) return;
    this.ordersGateway.notifyOrderStatus(order.referenceCode, 'listo', {
      customerId: order.customerId,
    });

    if (order.customerId == null) return;
    await this.notifications.create({
      type: 'ORDER',
      title: 'Tu pedido está listo 🎉',
      message: `Terminamos de alistar tu pedido ${order.referenceCode}. En breve sale a entrega.`,
      targetCustomerId: Number(order.customerId),
      linkUrl: '/account?tab=orders',
    });
  }

  /** Cola de picking (la "cola" vive en la BD: orders por estado + reviewedAt). */
  async queue(status?: string) {
    const tab: QueueTab =
      status === 'nuevo' || status === 'preparando' || status === 'completado'
        ? status
        : 'todos';

    let where;
    if (tab === 'nuevo') {
      where = and(
        isNull(orders.reviewedAt),
        inArray(orders.status, ['created', 'payment_pending', 'paid', 'preparing']),
      );
    } else if (tab === 'preparando') {
      where = eq(orders.status, 'preparing');
    } else if (tab === 'completado') {
      // "Completado" = ya se alistaron todos los items (listo), sin importar si
      // el repartidor ya lo recogió o entregó.
      where = inArray(orders.status, ['ready', 'shipped', 'delivered']);
    } else {
      where = inArray(orders.status, QUEUE_STATUSES);
    }

    const rows = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        status: orders.status,
        grandTotal: orders.grandTotal,
        createdAt: orders.createdAt,
        reviewedAt: orders.reviewedAt,
        branchId: orders.branchId,
        pickerId: orders.pickerId,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(isNull(orders.reviewedAt)), asc(orders.createdAt))
      .limit(500);

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

    return rows.map((r) => {
      const agg = aggByOrder.get(Number(r.id)) ?? { items: 0, pieces: 0, scanned: 0 };
      return {
        id: Number(r.id),
        referenceCode: r.referenceCode,
        customerName: r.customerName ?? 'Cliente',
        customerPhone: r.customerPhone,
        status: r.status,
        grandTotal: Number(r.grandTotal),
        createdAt: r.createdAt,
        reviewed: r.reviewedAt !== null,
        branchId: Number(r.branchId),
        pickerId: r.pickerId == null ? null : Number(r.pickerId),
        itemsCount: agg.items,
        totalPieces: agg.pieces,
        scannedPieces: agg.scanned,
      };
    });
  }

  async unreviewedCount() {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(orders)
      .where(
        and(
          isNull(orders.reviewedAt),
          inArray(orders.status, ['created', 'payment_pending', 'paid', 'preparing']),
        ),
      );
    return { count: row?.count ?? 0 };
  }

  /** Detalle del pedido con items (barcode, PLU, cantidades alistadas). */
  async detail(id: number) {
    const [order] = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        status: orders.status,
        grandTotal: orders.grandTotal,
        notes: orders.notes,
        reviewedAt: orders.reviewedAt,
        createdAt: orders.createdAt,
        branchId: orders.branchId,
        pickerId: orders.pickerId,
        pickerName: sql<string>`concat(${users.firstName}, ' ', ${users.lastName})`,
      })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.pickerId))
      .where(eq(orders.id, BigInt(id)))
      .limit(1);

    if (!order) {
      throw new NotFoundException(`No existe el pedido ${id}`);
    }

    const items = await this.db
      .select({
        id: orderItems.id,
        productVariantId: orderItems.productVariantId,
        name: orderItems.productName,
        sku: orderItems.variantSku,
        quantity: orderItems.quantity,
        pickedQty: orderItems.pickedQty,
        unitPriceGross: orderItems.unitPriceGross,
        total: orderItems.total,
        barcode: productVariants.barcode,
        plu: products.plu,
        image: media.path,
        shelfCode: shelves.code,
        shelfName: shelves.name,
        rowNumber: productLocations.rowNumber,
      })
      .from(orderItems)
      .leftJoin(productVariants, eq(productVariants.id, orderItems.productVariantId))
      .leftJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        productImages,
        and(eq(productImages.productId, products.id), eq(productImages.isCover, true)),
      )
      .leftJoin(media, eq(media.id, productImages.mediaId))
      .leftJoin(
        productLocations,
        and(
          eq(productLocations.productVariantId, orderItems.productVariantId),
          eq(productLocations.branchId, order.branchId),
        ),
      )
      .leftJoin(shelves, eq(shelves.id, productLocations.shelfId))
      .where(eq(orderItems.orderId, Number(id)))
      .orderBy(asc(orderItems.id));

    const scanned = items.reduce((s, i) => s + i.pickedQty, 0);
    const pieces = items.reduce((s, i) => s + i.quantity, 0);

    return {
      id: Number(order.id),
      referenceCode: order.referenceCode,
      customerName: order.customerName ?? 'Cliente',
      customerPhone: order.customerPhone,
      status: order.status,
      grandTotal: Number(order.grandTotal),
      notes: order.notes,
      reviewed: order.reviewedAt !== null,
      createdAt: order.createdAt,
      branchId: Number(order.branchId),
      pickerId: order.pickerId != null ? Number(order.pickerId) : null,
      pickerName: order.pickerName ?? null,
      itemsCount: items.length,
      totalPieces: pieces,
      scannedPieces: scanned,
      items: items.map((i) => ({
        id: Number(i.id),
        productVariantId: i.productVariantId != null ? Number(i.productVariantId) : null,
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        pickedQty: i.pickedQty,
        barcode: i.barcode,
        plu: i.plu,
        image: i.image ?? null,
        shelfCode: i.shelfCode ?? null,
        shelfName: i.shelfName ?? null,
        rowNumber: i.rowNumber ?? null,
        unitPriceGross: Number(i.unitPriceGross),
        total: Number(i.total),
      })),
    };
  }

  async markReviewed(id: number) {
    const [result] = await this.db
      .update(orders)
      .set({ reviewedAt: new Date().toISOString() })
      .where(and(eq(orders.id, BigInt(id)), isNull(orders.reviewedAt)))
      .returning({ id: orders.id });

    return { reviewed: result !== undefined };
  }

  /** Asignar el picker (usuario) que alista el pedido. */
  async claim(id: number, pickerId: number) {
    const [order] = await this.db
      .select({
        id: orders.id,
        pickerId: orders.pickerId,
        status: orders.status,
        referenceCode: orders.referenceCode,
        customerId: orders.customerId,
      })
      .from(orders)
      .where(eq(orders.id, BigInt(id)))
      .limit(1);
    if (!order) throw new NotFoundException(`No existe el pedido ${id}`);

    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, BigInt(pickerId)))
      .limit(1);
    if (!user) throw new NotFoundException(`El usuario ${pickerId} no existe`);

    // Al reclamar, el pedido pasa a "preparing" (alistamiento en curso).
    const nextStatus = isPickingTrigger(order.status) ? 'preparing' : order.status;

    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          pickerId,
          status: nextStatus,
          pickedAt: order.pickerId == null ? new Date().toISOString() : undefined,
        })
        .where(eq(orders.id, BigInt(id)));

      if (nextStatus !== order.status) {
        await tx.insert(orderStatusHistory).values({
          orderId: id,
          status: nextStatus,
          oldStatus: order.status,
          pickerId,
          createdAt: new Date().toISOString(),
        });
      }
    });

    // Refleja el cambio de estado en la app del cliente.
    if (nextStatus === 'preparing' && nextStatus !== order.status) {
      await this.notifyPreparing(order);
    }

    this.gateway.emit('picking:claim', {
      orderId: id,
      pickerId,
      timestamp: new Date().toISOString(),
    });
    return { success: true, pickerId, firstClaim: order.pickerId == null };
  }

  /** Escaneo de un código (barcode o PLU): alista 1 unidad del item que coincida. */
  async scan(id: number, code: string) {
    const [order] = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        referenceCode: orders.referenceCode,
        pickerId: orders.pickerId,
        customerId: orders.customerId,
      })
      .from(orders)
      .where(eq(orders.id, BigInt(id)))
      .limit(1);

    if (!order) {
      throw new NotFoundException(`No existe el pedido ${id}`);
    }
    if (!isPickingTrigger(order.status) && order.status !== 'preparing') {
      throw new ConflictException('Este pedido no está en alistamiento');
    }

    const items = await this.db
      .select({
        id: orderItems.id,
        name: orderItems.productName,
        quantity: orderItems.quantity,
        pickedQty: orderItems.pickedQty,
        barcode: productVariants.barcode,
        plu: products.plu,
      })
      .from(orderItems)
      .leftJoin(productVariants, eq(productVariants.id, orderItems.productVariantId))
      .leftJoin(products, eq(products.id, productVariants.productId))
      .where(eq(orderItems.orderId, Number(id)))
      .orderBy(asc(orderItems.id));

    const pending = items.filter((i) => i.pickedQty < i.quantity);

    // Buscar coincidencia del código con un item pendiente (barcode o PLU)
    const matched = pending.find((i) =>
      [i.barcode, i.plu].filter(Boolean).includes(code),
    );

    if (!matched) {
      const expected = [...new Set(pending.flatMap((i) => [i.barcode, i.plu]).filter(Boolean))];
      throw new ConflictException({
        message: `Producto incorrecto: escaneaste ${code}`,
        scanned: code,
        expected,
      });
    }

    const newPicked = matched.pickedQty + 1;

    // ¿Con este escaneo quedan todos los items alistados? La app lo usa para
    // llevar al picker a la verificación final, pero NO cambia el estado: el
    // pedido pasa a "listo" solo al confirmar "entregado en caja" (complete).
    const allDone = items.every((i) =>
      i.id === matched.id ? newPicked >= i.quantity : i.pickedQty >= i.quantity,
    );

    const nextStatus = isPickingTrigger(order.status) ? 'preparing' : order.status;

    await this.db.transaction(async (tx) => {
      await tx
        .update(orderItems)
        .set({ pickedQty: newPicked })
        .where(eq(orderItems.id, matched.id));

      if (nextStatus !== order.status) {
        await tx
          .update(orders)
          .set({ status: nextStatus })
          .where(eq(orders.id, BigInt(id)));
        await tx.insert(orderStatusHistory).values({
          orderId: id,
          status: nextStatus,
          oldStatus: order.status,
          pickerId: order.pickerId ?? undefined,
          createdAt: new Date().toISOString(),
        });
      }
    });

    // Refleja el cambio de estado en la app del cliente.
    if (nextStatus === 'preparing' && nextStatus !== order.status) {
      await this.notifyPreparing(order);
    }

    // Evento en vivo para el admin (Métricas): progreso actualizado del pedido
    const [agg] = await this.db
      .select({
        scanned: sql<number>`COALESCE(SUM(${orderItems.pickedQty}),0)::int`,
        pieces: sql<number>`COALESCE(SUM(${orderItems.quantity}),0)::int`,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, Number(id)));
    this.gateway.emit('picking:scan', {
      orderId: id,
      referenceCode: order.referenceCode,
      pickerId: order.pickerId ?? undefined,
      scannedPieces: agg?.scanned ?? 0,
      totalPieces: agg?.pieces ?? 0,
      timestamp: new Date().toISOString(),
    });

    return {
      ok: true,
      itemId: Number(matched.id),
      name: matched.name,
      pickedQty: newPicked,
      quantity: matched.quantity,
      remaining: matched.quantity - newPicked,
      allDone,
      orderStatus: nextStatus,
      expected: [matched.barcode, matched.plu].filter(Boolean),
    };
  }

  /**
   * Cerrar el alistamiento ("entregado en caja" + confirmar) y ofrecer el
   * pedido a delivery.
   *
   * Aquí es donde el pedido pasa a **"listo" (`ready`)**: el picker ya escaneó
   * todos los items y confirmó la entrega en caja. No se marca como
   * "entregado": eso lo hacen el repartidor (`shipped` = en camino) y la
   * entrega final (`delivered`). También registra el cierre (`completed_at`)
   * para las métricas de picking.
   */
  async complete(id: number) {
    const [order] = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        pickerId: orders.pickerId,
        referenceCode: orders.referenceCode,
        customerId: orders.customerId,
        completedAt: orders.completedAt,
      })
      .from(orders)
      .where(eq(orders.id, BigInt(id)))
      .limit(1);

    if (!order) {
      throw new NotFoundException(`No existe el pedido ${id}`);
    }
    if (order.completedAt != null) {
      return { ok: true, status: order.status, already: true };
    }

    const pending = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, Number(id)),
          sql`${orderItems.pickedQty} < ${orderItems.quantity}`,
        ),
      );

    if ((pending[0]?.count ?? 0) > 0) {
      throw new ConflictException(
        `Quedan ${pending[0]?.count} producto(s) sin escanear antes de entregar en caja`,
      );
    }

    // El pedido venía "preparando" (todos los items ya escaneados): al
    // confirmar la entrega en caja pasa a "listo".
    const nextStatus = isPickedDone(order.status) ? order.status : 'ready';
    const now = new Date().toISOString();

    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ status: nextStatus, completedAt: now })
        .where(eq(orders.id, BigInt(id)));

      if (nextStatus !== order.status) {
        await tx.insert(orderStatusHistory).values({
          orderId: id,
          status: nextStatus,
          oldStatus: order.status,
          pickerId: order.pickerId ?? undefined,
          createdAt: now,
        });
      }
    });

    if (nextStatus === 'ready' && nextStatus !== order.status) {
      await this.notifyReady(order);
    }

    this.gateway.emit('picking:delivered', {
      orderId: id,
      referenceCode: order.referenceCode,
      pickerId: order.pickerId ?? undefined,
      deliveredAt: now,
    });

    // Snapshot del volumen del pedido ANTES de ofrecerlo: así el cupo del
    // vehículo y el panel de planificación ya tienen el dato sin recalcularlo.
    await this.deliveryLoad.snapshotOrderLoad(id);

    // El pedido sale de picking → se ofrece a TODOS los repartidores activos
    // como "Nuevo" (una asignación ASSIGNED por repartidor).
    await this.deliveryOrders.broadcastNewOrderToAllDrivers(
      id,
      order.referenceCode,
    );

    return { ok: true, status: nextStatus, already: false };
  }
}
