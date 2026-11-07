import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { PickingGateway } from './picking.gateway';
import { OrdersGateway } from '../orders/orders.gateway';
import { DeliveryOrdersService } from '../delivery/delivery-orders.service';
import { DeliveryLoadService } from '../delivery/delivery-load.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PickerBreakService } from './picker-break.service';
import {
  estimatePickSeconds,
  nearestNeighborShelfOrder,
  routeDistance,
  type ShelfPoint,
} from './picker-routing';
import {
  branches,
  customerAddresses,
  deliveryZones,
  orderItems,
  orders,
  orderStatusHistory,
  productVariants,
  products,
  users,
  userBranches,
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

/**
 * Normaliza un código escaneado para compararlo con el catálogo.
 *
 * Un mismo producto puede venir como UPC-A (12 dígitos) o EAN-13 (13, con un
 * cero delante); el lector entrega una u otra según el símbolo impreso, así que
 * se equiparan a EAN-13. También recorta espacios que algunos lectores añaden.
 */
function normalizeScannedCode(code: string): string {
  const trimmed = code.trim();
  return /^\d{12}$/.test(trimmed) ? `0${trimmed}` : trimmed;
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
    private readonly breaks: PickerBreakService,
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
    /** Picker que tomó el pedido, si el aviso lo provoca un alistamiento. */
    pickerName?: string | null;
    pickerId?: number | null;
  }) {
    if (!order.referenceCode) return;
    this.ordersGateway.notifyOrderStatus(order.referenceCode, 'preparando', {
      customerId: order.customerId,
      pickerId: order.pickerId ?? null,
      pickerName: order.pickerName ?? null,
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
    /** Picker que cerró el alistamiento, si lo provoca el propio picker. */
    pickerName?: string | null;
    pickerId?: number | null;
  }) {
    if (!order.referenceCode) return;
    this.ordersGateway.notifyOrderStatus(order.referenceCode, 'listo', {
      customerId: order.customerId,
      pickerId: order.pickerId ?? null,
      pickerName: order.pickerName ?? null,
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

  /** Cola de picking (la "cola" vive en la BD: orders por estado + reviewedAt).
   *
   * Cuando llega `userId` (picker autenticado con sucursal asignada) la cola se
   * limita a los pedidos de **su sucursal**. Los pedidos sin sucursal/usuarios
   * sin sucursal no se filtran (compatibilidad). */
  async queue(status?: string, userId?: number) {
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

    // Filtro por sucursal del picker autenticado (si tiene una asignada).
    const branchId = userId != null ? await this.branchOfUser(userId) : null;
    if (branchId != null) {
      where = and(where, eq(orders.branchId, branchId));
    }

    // Un picker autenticado solo ve SUS pedidos (los que la cola le asignó).
    // El panel usa `/picking-admin/orders`, que no lleva este filtro.
    if (userId != null) {
      where = and(where, eq(orders.pickerId, userId));
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

  async unreviewedCount(userId?: number) {
    const base = and(
      isNull(orders.reviewedAt),
      inArray(orders.status, ['created', 'payment_pending', 'paid', 'preparing']),
    );
    // El conteo sigue la misma sucursal que la cola del picker.
    const branchId = userId != null ? await this.branchOfUser(userId) : null;
    let where = branchId != null ? and(base, eq(orders.branchId, branchId)) : base;
    // Un picker solo cuenta SUS pedidos pendientes (asignados por la cola).
    if (userId != null) {
      where = and(where, eq(orders.pickerId, userId));
    }
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(orders)
      .where(where);
    return { count: row?.count ?? 0 };
  }

  /** Sucursal asignada a un picker (una sola) o null si no tiene. */
  private async branchOfUser(userId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(eq(userBranches.userId, userId))
      .limit(1);
    return row ? Number(row.branchId) : null;
  }

  /**
   * Historial del picker: pedidos que alistó y cerró en caja (`completed_at`),
   * del más reciente al más antiguo, paginado (lazy load de la app).
   */
  async history(pickerId: number, offset = 0, limit = 10) {
    const where = and(
      eq(orders.pickerId, pickerId),
      isNotNull(orders.completedAt),
    );

    const [countRow] = await this.db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(orders)
      .where(where);

    const rows = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        customerName: orders.customerName,
        status: orders.status,
        grandTotal: orders.grandTotal,
        createdAt: orders.createdAt,
        pickedAt: orders.pickedAt,
        completedAt: orders.completedAt,
        itemsCount: sql<number>`(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = ${orders.id})`,
        totalPieces: sql<number>`(SELECT COALESCE(SUM(oi.quantity),0)::int FROM order_items oi WHERE oi.order_id = ${orders.id})`,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.completedAt), desc(orders.id))
      .limit(limit)
      .offset(offset);

    const total = Number(countRow?.total ?? 0);
    return {
      orders: rows.map((r) => ({
        id: Number(r.id),
        referenceCode: r.referenceCode,
        customerName: r.customerName ?? 'Cliente',
        status: r.status,
        grandTotal: Number(r.grandTotal),
        createdAt: r.createdAt,
        pickedAt: r.pickedAt,
        completedAt: r.completedAt,
        itemsCount: r.itemsCount,
        totalPieces: r.totalPieces,
      })),
      total,
      hasMore: offset + rows.length < total,
    };
  }

  /** Detalle del pedido con items (barcode, PLU, cantidades alistadas). */
  async detail(id: number) {
    const [order] = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        status: orders.status,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        customerEmail: orders.customerEmail,
        currencyCode: orders.currencyCode,
        subtotal: orders.subtotal,
        discountTotal: orders.discountTotal,
        taxTotal: orders.taxTotal,
        shippingCost: orders.shippingCost,
        shippingTax: orders.shippingTax,
        grandTotal: orders.grandTotal,
        notes: orders.notes,
        internalNotes: orders.internalNotes,
        reviewedAt: orders.reviewedAt,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        pickedAt: orders.pickedAt,
        completedAt: orders.completedAt,
        // La entrega real la marca el repartidor en el historial de estados.
        deliveredAt: sql<string | null>`(SELECT MAX(osh.created_at) FROM order_status_history osh WHERE osh.order_id = ${orders.id} AND osh.status = 'delivered')`,
        branchId: orders.branchId,
        branchName: branches.name,
        pickerId: orders.pickerId,
        pickerName: sql<string>`concat(${users.firstName}, ' ', ${users.lastName})`,
        zoneName: deliveryZones.name,
        addressAlias: customerAddresses.alias,
        addressLine1: customerAddresses.addressLine1,
        addressLine2: customerAddresses.addressLine2,
        addressCity: customerAddresses.city,
        addressState: customerAddresses.state,
        addressReference: customerAddresses.reference,
        addressInstructions: customerAddresses.deliveryInstructions,
      })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.pickerId))
      .leftJoin(branches, eq(branches.id, orders.branchId))
      .leftJoin(deliveryZones, eq(deliveryZones.id, orders.deliveryZoneId))
      .leftJoin(customerAddresses, eq(customerAddresses.id, orders.customerAddressId))
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
        shelfId: shelves.id,
        shelfX: shelves.posX,
        shelfY: shelves.posY,
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

    // Ruta óptima: estanterías distintas en orden de vecino más cercano.
    const distinctShelves = new Map<number, ShelfPoint>();
    for (const it of items) {
      if (it.shelfId != null && it.shelfX != null && it.shelfY != null) {
        const sid = Number(it.shelfId);
        if (!distinctShelves.has(sid)) {
          distinctShelves.set(sid, { shelfId: sid, x: it.shelfX, y: it.shelfY });
        }
      }
    }
    const shelfOrder = nearestNeighborShelfOrder([...distinctShelves.values()]);
    const stepByShelf = new Map(shelfOrder.map((s, idx) => [s.shelfId, idx + 1]));
    const totalCells = routeDistance(shelfOrder);
    const estimatedSeconds = estimatePickSeconds(pieces, totalCells);

    // Items en orden de ruta; los que no tienen ubicación quedan al final.
    const orderedItems = [...items]
      .map((it) => ({
        ...it,
        routeStep:
          it.shelfId != null && stepByShelf.has(Number(it.shelfId))
            ? stepByShelf.get(Number(it.shelfId))
            : null,
      }))
      .sort((a, b) => {
        const sa = a.routeStep ?? Number.MAX_SAFE_INTEGER;
        const sb = b.routeStep ?? Number.MAX_SAFE_INTEGER;
        return sa === sb ? Number(a.id) - Number(b.id) : sa - sb;
      });

    // Bitácora de estados (quién y cuándo movió el pedido).
    const timeline = await this.db
      .select({
        status: orderStatusHistory.status,
        oldStatus: orderStatusHistory.oldStatus,
        note: orderStatusHistory.note,
        pickerName: sql<string | null>`NULLIF(TRIM(CONCAT(${users.firstName}, ' ', ${users.lastName})), '')`,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .leftJoin(users, eq(users.id, orderStatusHistory.pickerId))
      .where(eq(orderStatusHistory.orderId, Number(id)))
      .orderBy(asc(orderStatusHistory.createdAt));

    return {
      id: Number(order.id),
      referenceCode: order.referenceCode,
      status: order.status,
      customerName: order.customerName ?? 'Cliente',
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      currencyCode: order.currencyCode,
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      shippingCost: Number(order.shippingCost),
      shippingTax: Number(order.shippingTax),
      grandTotal: Number(order.grandTotal),
      notes: order.notes,
      internalNotes: order.internalNotes,
      reviewed: order.reviewedAt !== null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      reviewedAt: order.reviewedAt,
      pickedAt: order.pickedAt,
      completedAt: order.completedAt,
      deliveredAt: order.deliveredAt ?? null,
      branchId: Number(order.branchId),
      branchName: order.branchName ?? null,
      pickerId: order.pickerId != null ? Number(order.pickerId) : null,
      pickerName: order.pickerName ?? null,
      delivery: {
        zoneName: order.zoneName ?? null,
        alias: order.addressAlias ?? null,
        line1: order.addressLine1 ?? null,
        line2: order.addressLine2 ?? null,
        city: order.addressCity ?? null,
        state: order.addressState ?? null,
        reference: order.addressReference ?? null,
        instructions: order.addressInstructions ?? null,
      },
      itemsCount: orderedItems.length,
      totalPieces: pieces,
      scannedPieces: scanned,
      route: {
        totalCells,
        estimatedMinutes: Math.max(1, Math.round(estimatedSeconds / 60)),
      },
      items: orderedItems.map((i) => ({
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
        // Ya no hay filas; se mantiene el campo por la app móvil.
        rowNumber: null,
        routeStep: i.routeStep ?? null,
        unitPriceGross: Number(i.unitPriceGross),
        total: Number(i.total),
      })),
      timeline: timeline.map((t) => ({
        status: t.status,
        oldStatus: t.oldStatus,
        note: t.note,
        pickerName: t.pickerName ?? null,
        createdAt: t.createdAt,
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
      .select({
        id: users.id,
        name: sql<string>`concat(${users.firstName}, ' ', ${users.lastName})`,
      })
      .from(users)
      .where(eq(users.id, BigInt(pickerId)))
      .limit(1);
    if (!user) throw new NotFoundException(`El usuario ${pickerId} no existe`);

    // La cola asigna cada pedido a un solo picker. Si ya lo tiene otro, no se
    // puede reclamar (evita que alguien se robe un pedido ajeno).
    if (order.pickerId != null && Number(order.pickerId) !== pickerId) {
      throw new ForbiddenException('Este pedido ya está asignado a otro picker');
    }

    // Al reclamar, el pedido pasa a "preparing" (alistamiento en curso).
    const nextStatus = isPickingTrigger(order.status) ? 'preparing' : order.status;
    // Se marca el inicio del alistamiento solo cuando realmente arranca (pasa de
    // un estado de cola a "preparing"), no al reabrir un pedido ya en curso.
    const starting = nextStatus === 'preparing' && order.status !== 'preparing';

    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          pickerId,
          status: nextStatus,
          pickedAt: starting ? new Date().toISOString() : undefined,
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
      await this.notifyPreparing({ ...order, pickerId, pickerName: user.name });
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
        branchId: orders.branchId,
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

    // Buscar coincidencia del código con un item pendiente (barcode/INEAN o PLU).
    // Se normalizan ambos lados (UPC-A ↔ EAN-13) para que el código leído por el
    // lector coincida aunque el formato impreso difiera del almacenado.
    const target = normalizeScannedCode(code);
    const matched = pending.find((i) =>
      [i.barcode, i.plu].some((v) => v != null && normalizeScannedCode(v) === target),
    );

    if (!matched) {
      const expected = [...new Set(pending.flatMap((i) => [i.barcode, i.plu]).filter(Boolean))];
      throw new ConflictException({
        message: `Producto incorrecto: escaneaste ${code}`,
        scanned: code,
        expected,
      });
    }

    return this.commitPick(id, order, items, matched, matched.pickedQty + 1);
  }

  /**
   * Marca un item como alistado por completo SIN escanear (confirmación manual
   * desde la app). Sirve cuando el lector no está disponible o el código no está
   * impreso. Aplica los mismos efectos que un escaneo (progreso, estado, historial).
   */
  async pickItem(id: number, itemId: number) {
    const [order] = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        referenceCode: orders.referenceCode,
        pickerId: orders.pickerId,
        customerId: orders.customerId,
        branchId: orders.branchId,
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

    const matched = items.find((i) => Number(i.id) === Number(itemId));
    if (!matched) {
      throw new NotFoundException('El producto no pertenece a este pedido');
    }

    // Completa lo que falte del item (si ya estaba completo no cambia nada).
    return this.commitPick(id, order, items, matched, Math.max(matched.pickedQty, matched.quantity));
  }

  /** Efectos comunes al alistar unidades (escaneo o confirmación manual). */
  private async commitPick(
    id: number,
    order: {
      status: typeof orders.$inferSelect.status;
      referenceCode: string | null;
      pickerId: number | null;
      customerId: number | null;
      branchId: number | null;
    },
    items: {
      id: bigint;
      name: string;
      quantity: number;
      pickedQty: number;
      barcode: string | null;
      plu: string | null;
    }[],
    matched: {
      id: bigint;
      name: string;
      quantity: number;
      pickedQty: number;
      barcode: string | null;
      plu: string | null;
    },
    newPicked: number,
  ) {
    // ¿Quedan todos los items alistados? La app lo usa para llevar al picker a la
    // verificación final, pero NO cambia el estado: el pedido pasa a "listo" solo
    // al confirmar "entregado en caja" (complete).
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
          .set({ status: nextStatus, pickedAt: new Date().toISOString() })
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

    // Descansos y metas: suma las unidades realmente alistadas en este pick.
    const unitsAdded = Math.max(0, newPicked - matched.pickedQty);
    let breakInfo: Awaited<ReturnType<PickerBreakService['recordPick']>> | null = null;
    if (unitsAdded > 0 && order.pickerId != null) {
      try {
        breakInfo = await this.breaks.recordPick({
          userId: order.pickerId,
          branchId: order.branchId ?? null,
          orderId: id,
          units: unitsAdded,
        });
      } catch (e) {
        // Un fallo del contador de descansos no debe tumbar el alistamiento.
        this.logger.error(
          `No se pudo registrar el descanso del picker ${order.pickerId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

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
      breakInfo,
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
      // Nombre del picker para que el panel muestre quién cerró el alistamiento.
      const [picker] =
        order.pickerId != null
          ? await this.db
              .select({
                name: sql<string>`concat(${users.firstName}, ' ', ${users.lastName})`,
              })
              .from(users)
              .where(eq(users.id, BigInt(order.pickerId)))
              .limit(1)
          : [];
      await this.notifyReady({ ...order, pickerName: picker?.name ?? null });
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
