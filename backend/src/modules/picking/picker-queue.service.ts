import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { PushService } from '../notifications/push.service';
import { estimateEtaSeconds, type ShelfPoint } from './picker-routing';
import {
  orderItems,
  orders,
  productLocations,
  shelves,
  users,
  userBranches,
} from '../../../drizzle/schema';

/** Estados en los que un pedido está listo para entrar (y ser asignado) a picking. */
const DISPATCH_STATUSES = ['created', 'payment_pending', 'paid'] as const;

/** Estados de pedidos que todavía ocupan al picker (asignados y sin cerrar). */
const PENDING_STATUSES = ['created', 'payment_pending', 'paid', 'preparing'] as const;

/**
 * Sistema de colas de picking: disponibilidad de pickers y despacho de pedidos.
 *
 * Cuando entra un pedido nuevo se asigna al picker **que terminará antes** su
 * carga actual (vecino más cercano + ETA), no al azar. Cada picker ve en
 * "Nuevos" únicamente los pedidos que le fueron asignados.
 *
 * El `free_at` de un picker es `now + Σ ETA` de sus pedidos pendientes (los
 * asignados y sin cerrar). Los descansos son opcionales y se reclaman aparte,
 * así que no bloquean la cola.
 */
@Injectable()
export class PickerQueueService {
  private readonly logger = new Logger(PickerQueueService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly push: PushService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  // ─── Disponibilidad / heartbeat ───────────────────────────────────────────

  /** Marca al picker disponible o en pausa (y actualiza su señal de vida). */
  async setAvailability(pickerId: number, available: boolean) {
    const now = new Date().toISOString();
    await this.db
      .update(users)
      .set({ isAvailable: available, lastSeenAt: now })
      .where(eq(users.id, BigInt(pickerId)));

    // Al volver a estar disponible, despacha los pedidos sin asignar de su
    // sucursal (los que llegaron cuando no había nadie libre).
    if (available) {
      await this.redispatchBranch(pickerId);
    }
    return { ok: true, pickerId, available };
  }

  /** Despacha los pedidos sin picker de la sucursal de un picker. */
  private async redispatchBranch(pickerId: number): Promise<void> {
    const [ub] = await this.db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(eq(userBranches.userId, pickerId))
      .limit(1);
    if (!ub) return;

    const unassigned = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.branchId, ub.branchId),
          isNull(orders.pickerId),
          inArray(orders.status, [...DISPATCH_STATUSES]),
        ),
      );

    for (const o of unassigned) {
      try {
        await this.dispatchNewOrder(Number(o.id));
      } catch (e) {
        this.logger.warn(
          `No se pudo despachar el pedido ${Number(o.id)}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** La app avisa que sigue abierta: refresca `last_seen_at`. */
  async heartbeat(pickerId: number) {
    await this.db
      .update(users)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(users.id, BigInt(pickerId)));
    return { ok: true };
  }

  // ─── ETA y disponibilidad de un picker ─────────────────────────────────────

  /** ETA en segundos de alistar lo que falta de un pedido (unidades + recorrido). */
  async orderEtaSeconds(orderId: number): Promise<{
    remainingPieces: number;
    etaSeconds: number;
  }> {
    const [order] = await this.db
      .select({ branchId: orders.branchId })
      .from(orders)
      .where(eq(orders.id, BigInt(orderId)))
      .limit(1);
    if (!order) return { remainingPieces: 0, etaSeconds: 0 };

    const rows = await this.db
      .select({
        quantity: orderItems.quantity,
        pickedQty: orderItems.pickedQty,
        shelfId: productLocations.shelfId,
        shelfX: shelves.posX,
        shelfY: shelves.posY,
      })
      .from(orderItems)
      .leftJoin(
        productLocations,
        and(
          eq(productLocations.productVariantId, orderItems.productVariantId),
          eq(productLocations.branchId, order.branchId),
        ),
      )
      .leftJoin(shelves, eq(shelves.id, productLocations.shelfId))
      .where(eq(orderItems.orderId, Number(orderId)));

    let remainingPieces = 0;
    const shelfMap = new Map<number, ShelfPoint>();
    for (const r of rows) {
      remainingPieces += Math.max(0, r.quantity - r.pickedQty);
      if (r.shelfId != null && r.shelfX != null && r.shelfY != null) {
        const sid = Number(r.shelfId);
        if (!shelfMap.has(sid)) {
          shelfMap.set(sid, { shelfId: sid, x: r.shelfX, y: r.shelfY });
        }
      }
    }

    const etaSeconds = estimateEtaSeconds(remainingPieces, [...shelfMap.values()]);
    return { remainingPieces, etaSeconds };
  }

  /** Cuándo quedará libre un picker (now + ETA de todos sus pedidos pendientes). */
  async computePickerFreeAt(pickerId: number): Promise<{
    freeAt: string;
    etaSeconds: number;
    queuedOrders: number;
  }> {
    const pending = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.pickerId, pickerId),
          inArray(orders.status, [...PENDING_STATUSES]),
          isNull(orders.completedAt),
        ),
      );

    let totalEta = 0;
    for (const o of pending) {
      const { etaSeconds } = await this.orderEtaSeconds(Number(o.id));
      totalEta += etaSeconds;
    }

    return {
      freeAt: new Date(Date.now() + totalEta * 1000).toISOString(),
      etaSeconds: totalEta,
      queuedOrders: pending.length,
    };
  }

  // ─── Despacho ──────────────────────────────────────────────────────────────

  /**
   * Asigna el pedido al picker disponible de su sucursal que terminará antes.
   * Idempotente: si ya tiene picker, no hace nada. Si no hay picker disponible,
   * lo deja sin asignar y avisa al panel.
   */
  async dispatchNewOrder(orderId: number): Promise<{
    assigned: boolean;
    pickerId: number | null;
    freeAt?: string;
  }> {
    const [order] = await this.db
      .select({
        id: orders.id,
        branchId: orders.branchId,
        status: orders.status,
        referenceCode: orders.referenceCode,
        pickerId: orders.pickerId,
      })
      .from(orders)
      .where(eq(orders.id, BigInt(orderId)))
      .limit(1);
    if (!order) return { assigned: false, pickerId: null };
    if (!(DISPATCH_STATUSES as readonly string[]).includes(order.status)) {
      return { assigned: false, pickerId: null };
    }
    if (order.pickerId != null) {
      return { assigned: true, pickerId: Number(order.pickerId) };
    }

    const candidates = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userBranches, eq(userBranches.userId, users.id))
      .where(
        and(
          eq(users.isPicker, true),
          eq(users.isActive, true),
          isNull(users.deletedAt),
          eq(users.isAvailable, true),
          eq(userBranches.branchId, order.branchId),
        ),
      );

    if (candidates.length === 0) {
      this.logger.warn(
        `Pedido ${order.referenceCode} sin picker disponible (sucursal ${order.branchId})`,
      );
      return { assigned: false, pickerId: null };
    }

    let chosen: number | null = null;
    let bestFreeAtMs = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const { etaSeconds } = await this.computePickerFreeAt(Number(c.id));
      const freeAtMs = Date.now() + etaSeconds * 1000;
      if (freeAtMs < bestFreeAtMs) {
        bestFreeAtMs = freeAtMs;
        chosen = Number(c.id);
      }
    }

    if (chosen == null) {
      return { assigned: false, pickerId: null };
    }

    // Asignación atómica: solo si sigue sin picker (evita doble asignación).
    const [updated] = await this.db
      .update(orders)
      .set({ pickerId: chosen })
      .where(and(eq(orders.id, BigInt(orderId)), isNull(orders.pickerId)))
      .returning({ id: orders.id });

    if (!updated) {
      return { assigned: false, pickerId: null };
    }

    void this.push.sendToUser(chosen, {
      title: 'Pedido asignado 🛒',
      body: `Pedido ${order.referenceCode} te fue asignado para alistar.`,
      data: {
        type: 'ORDER',
        orderId: String(orderId),
        referenceCode: order.referenceCode ?? '',
      },
      channelId: 'picking-alerts',
    });

    this.logger.log(
      `Pedido ${order.referenceCode} asignado al picker ${chosen} (sucursal ${order.branchId})`,
    );
    return { assigned: true, pickerId: chosen, freeAt: new Date(bestFreeAtMs).toISOString() };
  }
}
