import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  deliveryAssignments,
  deliveryDrivers,
  deliveryProofMedia,
  orderChatMessages,
  orders,
  shipments,
} from '../../../drizzle/schema';
import { parsePoint } from './delivery.service';
import { DeliveryGateway } from './delivery.gateway';
import { OrdersGateway } from '../orders/orders.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import type { TransitionDto } from './dto/transition.dto';

export interface TimelineEvent {
  event: string;
  at: string;
  description?: string | null;
}

/** Estados en los que el pedido sigue "activo" para el repartidor. */
const ACTIVE_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'IN_DELIVERY',
] as const;

const HISTORY_STATUSES = [
  'DELIVERED',
  'REJECTED',
  'FAILED_DELIVERY',
  'CANCELLED',
] as const;

/** Estados de la entrega en los que el chat por pedido está habilitado. */
const CHAT_ACTIVE_STATUSES = ['PICKED_UP', 'IN_DELIVERY'] as const;

/** Transiciones permitidas por estado (máquina de estados). */
const ALLOWED: Record<string, string[]> = {
  ASSIGNED: ['accept', 'reject'],
  ACCEPTED: ['arrived'],
  READY_FOR_PICKUP: ['pickup'],
  PICKED_UP: ['start'],
  IN_DELIVERY: ['deliver', 'fail'],
};

const NEXT_STATUS: Record<string, string> = {
  accept: 'ACCEPTED',
  reject: 'REJECTED',
  arrived: 'READY_FOR_PICKUP',
  // "Tengo el pedido" deja el pedido en camino de inmediato (sin paso extra).
  pickup: 'IN_DELIVERY',
  start: 'IN_DELIVERY',
  deliver: 'DELIVERED',
  fail: 'FAILED_DELIVERY',
};

interface OrderRow {
  order_id: string;
  reference_code: string;
  notes: string | null;
  grand_total: string | null;
  currency_code: string | null;
  shipping_cost: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  c_first_name: string | null;
  c_last_name: string | null;
  c_phone: string | null;
  status: string;
  assigned_at: string | null;
  accepted_at: string | null;
  ready_for_pickup_at: string | null;
  picked_up_at: string | null;
  in_delivery_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  location: string | null;
  branch_name: string | null;
  branch_address: string | null;
  branch_location: string | null;
  payment_method: string | null;
  assignment_id: string;
  shipment_id: string;
}

interface ItemRow {
  order_id: string;
  product_name: string;
  quantity: string;
  product_image: string | null;
}

interface AssignmentRow {
  assignment_id: string;
  shipment_id: string;
  order_id: string;
  status: string;
  customer_id: string | null;
  reference_code: string;
}

const ORDERS_SELECT = `
SELECT
  o.id AS order_id,
  o.reference_code,
  o.notes,
  o.grand_total,
  o.currency_code,
  o.shipping_cost,
  o.customer_name,
  o.customer_phone,
  c.first_name AS c_first_name,
  c.last_name AS c_last_name,
  c.phone AS c_phone,
  a.status,
  a.assigned_at, a.accepted_at, a.ready_for_pickup_at, a.picked_up_at,
  a.in_delivery_at, a.completed_at, a.rejected_at, a.failed_at, a.cancelled_at,
  a.reject_reason, a.cancel_reason,
  s.address_line1, s.address_line2, s.city, s.location,
  b.name AS branch_name, b.address AS branch_address, b.location AS branch_location,
  p.payment_method,
  a.id AS assignment_id,
  s.id AS shipment_id
FROM delivery_assignments a
JOIN shipments s ON s.id = a.shipment_id
JOIN orders o ON o.id = s.order_id
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN branches b ON b.id = o.branch_id
LEFT JOIN LATERAL (
  SELECT payment_method FROM payments WHERE order_id = o.id
  ORDER BY created_at DESC LIMIT 1
) p ON true
`;

function buildTimeline(row: OrderRow): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (
    event: string,
    at: string | null,
    description?: string | null,
  ) => {
    if (at) events.push({ event, at, description: description ?? null });
  };
  push('ASSIGNED', row.assigned_at);
  push('ACCEPTED', row.accepted_at);
  push('ARRIVED', row.ready_for_pickup_at);
  push('PICKED_UP', row.picked_up_at);
  push('IN_DELIVERY', row.in_delivery_at);
  push('DELIVERED', row.completed_at);
  push(
    'FAILED_DELIVERY',
    row.failed_at,
    row.reject_reason ?? row.cancel_reason,
  );
  push('REJECTED', row.rejected_at, row.reject_reason);
  push('CANCELLED', row.cancelled_at, row.cancel_reason);
  return events.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

type AssignmentUpdate = Partial<typeof deliveryAssignments.$inferInsert>;

/** Timestamp que se sella con cada acción. */
function tsPatch(action: string, now: string): AssignmentUpdate {
  switch (action) {
    case 'accept':
      return { acceptedAt: now };
    case 'arrived':
      return { readyForPickupAt: now };
    case 'pickup':
      // El pedido pasa directo a "en camino".
      return { pickedUpAt: now, inDeliveryAt: now };
    case 'start':
      return { inDeliveryAt: now };
    case 'deliver':
      return { completedAt: now };
    case 'fail':
      return { failedAt: now };
    case 'reject':
      return { rejectedAt: now };
    default:
      return {};
  }
}

@Injectable()
export class DeliveryOrdersService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly gateway: DeliveryGateway,
    private readonly ordersGateway: OrdersGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  private async fetchItems(orderIds: string[]) {
    if (!orderIds.length) return new Map<string, ItemRow[]>();
    const rows = await this.drizzle.execute<ItemRow>(
      `SELECT oi.order_id, oi.product_name, oi.quantity, m.path AS product_image
       FROM order_items oi
       LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
       LEFT JOIN product_images pi ON pi.product_id = pv.product_id AND pi.is_cover = true
       LEFT JOIN media m ON m.id = pi.media_id
       WHERE oi.order_id = ANY($1::bigint[])
       ORDER BY oi.id ASC`,
      [orderIds.map((id) => Number(id))],
    );
    const map = new Map<string, ItemRow[]>();
    for (const r of rows) {
      const list = map.get(r.order_id) ?? [];
      list.push(r);
      map.set(r.order_id, list);
    }
    return map;
  }

  private toDeliveryOrder(row: OrderRow, items: ItemRow[]) {
    const branchPoint = parsePoint(row.branch_location);
    return {
      id: Number(row.order_id),
      referenceCode: row.reference_code,
      status: row.status,
      customer: {
        name:
          row.customer_name ||
          [row.c_first_name, row.c_last_name].filter(Boolean).join(' ') ||
          'Cliente',
        phone: row.customer_phone || row.c_phone || '',
      },
      address: {
        line1: row.address_line1 ?? '',
        line2: row.address_line2,
        city: row.city,
        notes: row.notes,
      },
      destination: parsePoint(row.location),
      items: items.map((i) => ({
        name: i.product_name,
        quantity: Number(i.quantity),
        image: i.product_image,
      })),
      totals: {
        value: Number(row.grand_total ?? 0),
        currency: row.currency_code ?? 'COP',
        shipping: Number(row.shipping_cost ?? 0),
      },
      payment: {
        method: row.payment_method ?? 'CASH',
        label: row.payment_method === 'CASH' ? 'Contraentrega' : 'Pagado',
      },
      pickup: {
        branch: {
          name: row.branch_name ?? 'Tienda',
          address: row.branch_address,
          lat: branchPoint?.lat ?? null,
          lng: branchPoint?.lng ?? null,
        },
      },
      timeline: buildTimeline(row),
      assignedAt: row.assigned_at,
      acceptedAt: row.accepted_at,
      pickedUpAt: row.picked_up_at,
      completedAt: row.completed_at,
      rejectReason: row.reject_reason,
      deliveredAt: row.completed_at,
    };
  }

  private async rowsToOrders(rows: OrderRow[]) {
    const items = await this.fetchItems(rows.map((r) => r.order_id));
    return rows.map((r) =>
      this.toDeliveryOrder(r, items.get(r.order_id) ?? []),
    );
  }

  async listActive(driverId: number) {
    const rows = await this.drizzle.execute<OrderRow>(
      `${ORDERS_SELECT}
       WHERE a.driver_id = $1 AND a.status::text = ANY($2::text[])
       ORDER BY a.assigned_at DESC`,
      [driverId, [...ACTIVE_STATUSES]],
    );
    return this.rowsToOrders(rows);
  }

  async getOrder(driverId: number, orderId: number) {
    const rows = await this.drizzle.execute<OrderRow>(
      `${ORDERS_SELECT}
       WHERE a.driver_id = $1 AND o.id = $2
       ORDER BY a.id DESC LIMIT 1`,
      [driverId, orderId],
    );
    if (!rows.length) throw new NotFoundException('Pedido no encontrado.');
    return (await this.rowsToOrders(rows))[0];
  }

  /** Mensajes del chat del pedido. Solo el repartidor asignado puede leerlos. */
  async getChatMessages(driverId: number, orderId: number) {
    // getOrder lanza 404 si el pedido no está asignado a este repartidor.
    await this.getOrder(driverId, orderId);

    const rows = await this.db
      .select({
        id: orderChatMessages.id,
        senderType: orderChatMessages.senderType,
        body: orderChatMessages.body,
        createdAt: orderChatMessages.createdAt,
      })
      .from(orderChatMessages)
      .where(eq(orderChatMessages.orderId, BigInt(orderId)))
      .orderBy(asc(orderChatMessages.id))
      .limit(300);

    return rows.map((r) => ({
      id: String(r.id),
      senderType: r.senderType,
      body: r.body,
      createdAt: r.createdAt,
    }));
  }

  /** Envía un mensaje del repartidor en el chat del pedido asignado. */
  async sendChatMessage(
    driverId: number,
    orderId: number,
    userId: number,
    body: string,
  ) {
    // getOrder lanza 404 si el pedido no está asignado a este repartidor.
    const order = await this.getOrder(driverId, orderId);

    const text = (body ?? '').trim();
    if (!text) {
      throw new BadRequestException('Escribe un mensaje.');
    }
    if (text.length > 2000) {
      throw new BadRequestException(
        'El mensaje no puede superar 2000 caracteres.',
      );
    }
    // El chat solo se escribe mientras la entrega está en camino; la lectura
    // (historial) sigue disponible después de entregar.
    if (
      !CHAT_ACTIVE_STATUSES.includes(
        order.status as (typeof CHAT_ACTIVE_STATUSES)[number],
      )
    ) {
      throw new ConflictException(
        'El chat está disponible solo mientras el pedido está en camino.',
      );
    }

    const [row] = await this.db
      .insert(orderChatMessages)
      .values({
        orderId: BigInt(orderId),
        senderType: 'delivery',
        senderUserId: userId,
        body: text,
      })
      .returning();

    return {
      id: String(row.id),
      senderType: row.senderType,
      body: row.body,
      createdAt: row.createdAt,
    };
  }

  async history(driverId: number) {
    const rows = await this.drizzle.execute<OrderRow>(
      `${ORDERS_SELECT}
       WHERE a.driver_id = $1 AND a.status::text = ANY($2::text[])
       ORDER BY a.completed_at DESC NULLS LAST, a.id DESC`,
      [driverId, [...HISTORY_STATUSES]],
    );
    return this.rowsToOrders(rows);
  }

  /**
   * Un pedido sale de picking: se ofrece como "Nuevo" a TODOS los
   * repartidores activos (una asignación ASSIGNED por repartidor). Cuando
   * uno lo acepta, las ofertas de los demás se cancelan en `transition`.
   */
  async broadcastNewOrderToAllDrivers(orderId: number, referenceCode: string) {
    const [shipment] = await this.db
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.orderId, orderId))
      .limit(1);
    if (!shipment) return;

    const drivers = await this.db
      .select({
        id: deliveryDrivers.id,
        authUserId: deliveryDrivers.authUserId,
      })
      .from(deliveryDrivers)
      .where(
        and(
          eq(deliveryDrivers.isActive, true),
          isNull(deliveryDrivers.deletedAt),
        ),
      );

    const now = new Date().toISOString();
    const notifiedUserIds: number[] = [];

    for (const driver of drivers) {
      const [existing] = await this.db
        .select({ id: deliveryAssignments.id })
        .from(deliveryAssignments)
        .where(
          and(
            eq(deliveryAssignments.shipmentId, Number(shipment.id)),
            eq(deliveryAssignments.driverId, Number(driver.id)),
          ),
        )
        .limit(1);
      if (existing) continue;

      await this.db
        .insert(deliveryAssignments)
        .values({
          shipmentId: Number(shipment.id),
          driverId: Number(driver.id),
          status: 'ASSIGNED',
          assignedAt: now,
        })
        .onConflictDoNothing();

      if (driver.authUserId != null) {
        notifiedUserIds.push(Number(driver.authUserId));
      }
    }

    for (const userId of notifiedUserIds) {
      this.gateway.emitToDriver(userId, 'delivery:assigned', {
        orderId,
        referenceCode,
      });
    }
    if (notifiedUserIds.length) {
      this.gateway.emitFleetStatus({
        event: 'order-assigned',
        orderId,
        referenceCode,
        drivers: notifiedUserIds.length,
      });
    }
  }

  async transition(
    driverId: number,
    orderId: number,
    action: string,
    payload?: TransitionDto,
  ) {
    const rows = await this.drizzle.execute<AssignmentRow>(
      `SELECT a.id AS assignment_id, a.status,
              s.id AS shipment_id, o.id AS order_id,
              o.customer_id, o.reference_code
       FROM delivery_assignments a
       JOIN shipments s ON s.id = a.shipment_id
       JOIN orders o ON o.id = s.order_id
       WHERE a.driver_id = $1 AND o.id = $2
       ORDER BY a.id DESC LIMIT 1`,
      [driverId, orderId],
    );
    const assignment = rows[0];
    if (!assignment) throw new NotFoundException('Pedido no encontrado.');

    const allowed = ALLOWED[assignment.status] ?? [];
    if (!allowed.includes(action)) {
      throw new ConflictException(
        `Acción no permitida en estado ${assignment.status}.`,
      );
    }
    if ((action === 'reject' || action === 'fail') && !payload?.reason) {
      throw new BadRequestException('Debes indicar un motivo.');
    }

    const now = new Date().toISOString();
    const cancelledDriverIds: number[] = [];

    // Pool de pedidos nuevos: si otro repartidor ya tomó este envío, se
    // cancela la oferta propia y se rechaza la acción.
    if (action === 'accept') {
      const [taken] = await this.db
        .select({ id: deliveryAssignments.id })
        .from(deliveryAssignments)
        .where(
          and(
            eq(deliveryAssignments.shipmentId, Number(assignment.shipment_id)),
            ne(deliveryAssignments.driverId, driverId),
            inArray(deliveryAssignments.status, [
              'ACCEPTED',
              'READY_FOR_PICKUP',
              'PICKED_UP',
              'IN_DELIVERY',
            ]),
          ),
        )
        .limit(1);
      if (taken) {
        await this.db
          .update(deliveryAssignments)
          .set({
            status: 'CANCELLED',
            cancelledAt: now,
            cancelReason: 'Otro repartidor aceptó el pedido primero',
          })
          .where(eq(deliveryAssignments.id, BigInt(assignment.assignment_id)));
        throw new ConflictException('Otro repartidor ya aceptó este pedido.');
      }
    }

    // Un repartidor solo puede tener una entrega en curso a la vez.
    if (action === 'pickup') {
      const [other] = await this.db
        .select({ id: deliveryAssignments.id })
        .from(deliveryAssignments)
        .where(
          and(
            eq(deliveryAssignments.driverId, driverId),
            ne(deliveryAssignments.id, BigInt(assignment.assignment_id)),
            inArray(deliveryAssignments.status, ['PICKED_UP', 'IN_DELIVERY']),
          ),
        )
        .limit(1);
      if (other) {
        throw new ConflictException(
          'Tienes otra entrega en curso; termínala antes de recoger este pedido.',
        );
      }
    }

    // Prueba de entrega: la app exige 2 fotos (lugar + pedido) para confirmar.
    const proofLocationUrl = payload?.proofLocationUrl?.trim();
    const proofPackageUrl = payload?.proofPackageUrl?.trim();
    if (action === 'deliver' && (!proofLocationUrl || !proofPackageUrl)) {
      throw new BadRequestException(
        'La entrega requiere la foto del lugar y la foto del pedido.',
      );
    }

    const patch: AssignmentUpdate = {
      status: NEXT_STATUS[action] as AssignmentUpdate['status'],
      ...tsPatch(action, now),
      ...(action === 'reject' || action === 'fail'
        ? { rejectReason: payload?.reason }
        : {}),
      ...(action === 'deliver'
        ? { deliveryNote: payload?.note?.trim() || null }
        : {}),
    };

    await this.drizzle.transaction(async (tx) => {
      await tx
        .update(deliveryAssignments)
        .set(patch)
        .where(eq(deliveryAssignments.id, BigInt(assignment.assignment_id)));

      // Pool: al aceptar, se cancelan las ofertas de los demás repartidores.
      if (action === 'accept') {
        const others = await tx
          .select({
            id: deliveryAssignments.id,
            driverId: deliveryAssignments.driverId,
          })
          .from(deliveryAssignments)
          .where(
            and(
              eq(
                deliveryAssignments.shipmentId,
                Number(assignment.shipment_id),
              ),
              ne(deliveryAssignments.id, BigInt(assignment.assignment_id)),
              eq(deliveryAssignments.status, 'ASSIGNED'),
            ),
          );
        for (const other of others) {
          await tx
            .update(deliveryAssignments)
            .set({
              status: 'CANCELLED',
              cancelledAt: now,
              cancelReason: 'Otro repartidor aceptó el pedido',
            })
            .where(eq(deliveryAssignments.id, other.id));
        }
        cancelledDriverIds.push(...others.map((o) => Number(o.driverId)));
      }

      if (action === 'deliver') {
        await tx
          .update(shipments)
          .set({ status: 'DELIVERED', deliveredAt: now })
          .where(eq(shipments.id, BigInt(assignment.shipment_id)));
        await tx
          .update(orders)
          .set({ status: 'delivered' })
          .where(eq(orders.id, BigInt(orderId)));
        await tx.insert(deliveryProofMedia).values([
          {
            assignmentId: Number(assignment.assignment_id),
            kind: 'LOCATION',
            url: proofLocationUrl!,
          },
          {
            assignmentId: Number(assignment.assignment_id),
            kind: 'PACKAGE',
            url: proofPackageUrl!,
          },
        ]);
      }
      if (NEXT_STATUS[action] === 'IN_DELIVERY') {
        // El repartidor va en camino → el cliente ve el pedido como "En camino".
        await tx
          .update(orders)
          .set({ status: 'shipped' })
          .where(eq(orders.id, BigInt(orderId)));
      }
    });

    // Avisa al panel administrativo (sala `fleet`) para refrescar en vivo.
    this.gateway.emitFleetStatus({
      event: 'order-status',
      orderId,
      driverId,
      status: NEXT_STATUS[action],
    });

    // Avisa a los repartidores cuyas ofertas se cancelaron para que
    // refresquen su lista de pedidos nuevos.
    if (cancelledDriverIds.length) {
      const cancelledRows = await this.db
        .select({ authUserId: deliveryDrivers.authUserId })
        .from(deliveryDrivers)
        .where(
          inArray(
            deliveryDrivers.id,
            cancelledDriverIds.map((n) => BigInt(n)),
          ),
        );
      for (const row of cancelledRows) {
        if (row.authUserId != null) {
          this.gateway.emitToDriver(
            Number(row.authUserId),
            'delivery:order-updated',
            {
              orderId,
            },
          );
        }
      }
    }

    // El avance del reparto también viaja por el canal general de pedidos
    // (`/orders`): así el cliente lo ve en vivo en su tarjeta/rastreo y los
    // paneles administrativos (sala `staff`) se enteran al instante.
    //
    // Se decide por el estado RESULTANTE y no por la acción: "Tengo el pedido"
    // (`pickup`) y el antiguo `start` llevan al mismo sitio (en camino).
    if (NEXT_STATUS[action] === 'IN_DELIVERY') {
      this.ordersGateway.notifyOrderStatus(
        assignment.reference_code,
        'en camino',
        {
          customerId:
            assignment.customer_id != null
              ? Number(assignment.customer_id)
              : null,
        },
      );
    } else if (NEXT_STATUS[action] === 'DELIVERED') {
      this.ordersGateway.notifyOrderStatus(
        assignment.reference_code,
        'entregado',
        {
          customerId:
            assignment.customer_id != null
              ? Number(assignment.customer_id)
              : null,
        },
      );
    }

    // El cliente recibe la notificación (con botón para ver el rastreo) cuando
    // el repartidor sale con el pedido.
    if (
      NEXT_STATUS[action] === 'IN_DELIVERY' &&
      assignment.customer_id != null
    ) {
      await this.notificationsService.create({
        type: 'ORDER',
        title: 'Tu pedido está en camino 🛵',
        message: `El repartidor salió con tu pedido ${assignment.reference_code}. Síguelo en el mapa.`,
        targetCustomerId: Number(assignment.customer_id),
        linkUrl: `order-track:${assignment.reference_code}`,
      });
    }

    // Y otra cuando queda entregado: cierra el ciclo para el cliente.
    if (NEXT_STATUS[action] === 'DELIVERED' && assignment.customer_id != null) {
      await this.notificationsService.create({
        type: 'ORDER',
        title: 'Tu pedido fue entregado 🎉',
        message: `Tu pedido ${assignment.reference_code} llegó a su destino. ¡Gracias por comprar en Mercaldas!`,
        targetCustomerId: Number(assignment.customer_id),
        linkUrl: `order-track:${assignment.reference_code}`,
      });
    }

    return this.getOrder(driverId, orderId);
  }

  async setAvailability(driverId: number, isAvailable: boolean) {
    await this.db
      .update(deliveryDrivers)
      .set({ isAvailable, lastSeenAt: new Date().toISOString() })
      .where(eq(deliveryDrivers.id, BigInt(driverId)));
    this.gateway.emitFleetStatus({
      event: 'availability',
      driverId,
      isAvailable,
    });
    return { ok: true };
  }

  async setPushToken(driverId: number, token: string) {
    await this.db
      .update(deliveryDrivers)
      .set({ pushToken: token })
      .where(eq(deliveryDrivers.id, BigInt(driverId)));
    return { ok: true };
  }
}
