import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  orderItems,
  orders,
  orderStatusHistory,
  productVariants,
  products,
} from '../../../drizzle/schema';

/** Estados que pertenecen a la cola de picking. */
const QUEUE_STATUSES = [
  'created',
  'payment_pending',
  'paid',
  'preparing',
  'delivered',
] as const;

type QueueTab = 'nuevo' | 'preparando' | 'completado' | 'todos';

@Injectable()
export class PickingService {
  private readonly logger = new Logger(PickingService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
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
      where = eq(orders.status, 'delivered');
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
      })
      .from(orders)
      .where(eq(orders.id, BigInt(id)))
      .limit(1);

    if (!order) {
      throw new NotFoundException(`No existe el pedido ${id}`);
    }

    const items = await this.db
      .select({
        id: orderItems.id,
        name: orderItems.productName,
        sku: orderItems.variantSku,
        quantity: orderItems.quantity,
        pickedQty: orderItems.pickedQty,
        unitPriceGross: orderItems.unitPriceGross,
        total: orderItems.total,
        barcode: productVariants.barcode,
        plu: products.plu,
      })
      .from(orderItems)
      .leftJoin(productVariants, eq(productVariants.id, orderItems.productVariantId))
      .leftJoin(products, eq(products.id, productVariants.productId))
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
      itemsCount: items.length,
      totalPieces: pieces,
      scannedPieces: scanned,
      items: items.map((i) => ({
        id: Number(i.id),
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        pickedQty: i.pickedQty,
        barcode: i.barcode,
        plu: i.plu,
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

  /** Escaneo de un código (barcode o PLU): alista 1 unidad del item que coincida. */
  async scan(id: number, code: string) {
    const [order] = await this.db
      .select({ id: orders.id, status: orders.status, referenceCode: orders.referenceCode })
      .from(orders)
      .where(eq(orders.id, BigInt(id)))
      .limit(1);

    if (!order) {
      throw new NotFoundException(`No existe el pedido ${id}`);
    }
    if (order.status !== 'paid' && order.status !== 'preparing') {
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
    const nextStatus = order.status === 'paid' ? 'preparing' : order.status;

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
          createdAt: new Date().toISOString(),
        });
      }
    });

    const allDone = items.every((i) =>
      i.id === matched.id ? newPicked >= i.quantity : i.pickedQty >= i.quantity,
    );

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

  /** Completar el alistamiento: "entregado en caja" → pedido entregado. */
  async complete(id: number) {
    const [order] = await this.db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, BigInt(id)))
      .limit(1);

    if (!order) {
      throw new NotFoundException(`No existe el pedido ${id}`);
    }
    if (order.status === 'delivered') {
      return { ok: true, status: 'delivered', already: true };
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

    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ status: 'delivered' })
        .where(eq(orders.id, BigInt(id)));
      await tx.insert(orderStatusHistory).values({
        orderId: id,
        status: 'delivered',
        oldStatus: order.status,
        createdAt: new Date().toISOString(),
      });
    });

    return { ok: true, status: 'delivered', already: false };
  }
}
