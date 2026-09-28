import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import {
  branches,
  customerAddresses,
  customers,
  deliveryAssignments,
  deliveryDrivers,
  guestSessions,
  media,
  orderItems,
  orders,
  orderChatMessages,
  orderStatusHistory,
  paymentIntents,
  payments,
  productImages,
  productVariants,
  products,
  shipments,
  users,
} from '../../../drizzle/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { randomUUID } from 'node:crypto';
import { PaymentVerificationService } from './payment-verification.service';
import { WompiService } from '../payments/wompi.service';
import { EpaycoService } from '../payments/epayco.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { OrdersGateway } from './orders.gateway';
import { toIsoTimestamp } from '../../utils/date-utils';
import { parsePointText } from '../../utils/geolocation';

const OSRM_URL = process.env.OSRM_URL ?? 'http://localhost:5000';

/** Recorta el cuerpo para la notificación push (~120 caracteres). */
function truncatePushBody(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
/** La vista pública del cliente puede refrescar seguido: cachear la ruta. */
const LIVE_ROUTE_TTL_MS = 30_000;

/** Estados de la entrega en los que el chat por pedido está habilitado. */
const CHAT_ACTIVE_STATUSES = ['PICKED_UP', 'IN_DELIVERY'] as const;

export interface LiveRoute {
  polyline: string;
  distanceM: number;
  durationS: number;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly wompiService: WompiService,
    private readonly epaycoService: EpaycoService,
    private readonly paymentVerification: PaymentVerificationService,
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
    private readonly ordersGateway: OrdersGateway,
  ) {}

  private get db() {
    return this.drizzleService.db;
  }

  /** Caché corta de rutas del mapa público (clave: código de pedido). */
  private readonly liveRouteCache = new Map<
    string,
    { at: number; data: LiveRoute | null }
  >();

  async checkout(customerId: number, dto: CreateOrderDto) {
    const customer = await this.getCustomer(customerId);
    return this.createOrder({
      dto,
      customerId,
      guestSessionId: null,
      customerEmail: customer.email,
      customerName: [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || null,
      customerPhone: customer.phone ?? null,
      saveAddress: true,
    });
  }

  /**
   * Checkout SIN iniciar sesión: crea una sesión invitado y además guarda
   * (o recupera) el cliente por email, para usar sus datos luego como usuario.
   */
  async checkoutGuest(dto: CreateOrderDto) {
    const token = randomUUID();
    const [session] = await this.db
      .insert(guestSessions)
      .values({ sessionToken: token })
      .returning({ id: guestSessions.id });

    // Guardar/recuperar el cliente por email (único) para poder usarlo luego
    // como usuario: si ya existe se asocia el pedido a su cuenta; si no, se
    // crea un cliente sin contraseña (provider 'guest').
    const email = (dto.address.email ?? '').toLowerCase().trim();
    const nameParts = (dto.address.name ?? '').trim().split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = nameParts.slice(1).join(' ') || null;

    let customerId: number | null = null;
    const [existing] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email))
      .limit(1);

    if (existing) {
      customerId = Number(existing.id);
    } else {
      try {
        const [created] = await this.db
          .insert(customers)
          .values({
            email,
            firstName,
            lastName,
            phone: dto.address.phone,
            provider: 'guest',
            acceptsTermsAt: new Date().toISOString(),
          })
          .returning({ id: customers.id });
        customerId = Number(created.id);
      } catch {
        // Carrera con un pedido simultáneo del mismo email: re-leer el cliente
        const [again] = await this.db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.email, email))
          .limit(1);
        customerId = again ? Number(again.id) : null;
      }
    }

    return this.createOrder({
      dto,
      customerId,
      guestSessionId: Number(session.id),
      customerEmail: email,
      customerName: dto.address.name,
      customerPhone: dto.address.phone,
      saveAddress: false,
    });
  }

  private async createOrder(opts: {
    dto: CreateOrderDto;
    customerId: number | null;
    guestSessionId: number | null;
    customerEmail: string;
    customerName: string | null;
    customerPhone: string | null;
    saveAddress: boolean;
  }) {
    const {
      dto,
      customerId,
      guestSessionId,
      customerEmail,
      customerName,
      customerPhone,
      saveAddress,
    } = opts;

    if (!dto.items.length) {
      throw new BadRequestException('El carrito no puede estar vacío');
    }

    this.validatePaymentDetails(dto);

    const branch = await this.getDefaultBranch();
    const shippingCost = dto.shippingType === 'express' ? 9900 : 4900;

    const productIds = dto.items.map((item) => item.productId);
    const variants = await this.db
      .select({
        variantId: productVariants.id,
        productId: productVariants.productId,
        sku: productVariants.sku,
        price: productVariants.currentPrice,
        productName: products.name,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          inArray(productVariants.productId, productIds),
          eq(productVariants.isActive, true),
          isNull(productVariants.deletedAt),
          eq(products.isActive, true),
          isNull(products.deletedAt),
        ),
      )
      .orderBy(asc(productVariants.productId), asc(productVariants.id));

    const variantByProductId = new Map<number, (typeof variants)[number]>();
    for (const variant of variants) {
      const productId = Number(variant.productId);
      if (!variantByProductId.has(productId)) {
        variantByProductId.set(productId, variant);
      }
    }

    const missingProductIds = productIds.filter(
      (productId) => !variantByProductId.has(productId),
    );

    if (missingProductIds.length) {
      throw new NotFoundException(
        `No se encontraron variantes activas para los productos: ${missingProductIds.join(', ')}`,
      );
    }

    const normalizedItems = dto.items.map((item) => {
      const variant = variantByProductId.get(item.productId)!;
      const unitPrice = Number(variant.price);
      const subtotal = unitPrice * item.quantity;

      return {
        productId: item.productId,
        productVariantId: Number(variant.variantId),
        productName: variant.productName,
        variantSku: variant.sku,
        quantity: item.quantity,
        unitPrice,
        subtotal,
      };
    });

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );
    const grandTotal = subtotal + shippingCost;
    const amountInCents = grandTotal * 100;
    const referenceCode = this.buildReferenceCode();

    const cardProvider = dto.paymentDetails?.card?.provider ?? 'epayco';

    const cardTransaction =
      dto.paymentMethod === 'tarjeta'
        ? cardProvider === 'wompi'
          ? await this.wompiService.createCardTransaction({
              amountInCents,
              customerEmail,
              reference: referenceCode,
              acceptanceToken: dto.paymentDetails!.card!.acceptanceToken!,
              acceptPersonalAuth: dto.paymentDetails!.card!.acceptPersonalAuth!,
              cardToken: dto.paymentDetails!.card!.cardToken,
              installments: dto.paymentDetails!.card!.installments ?? 1,
              customerData: {
                phone_number: dto.address.phone,
                full_name: dto.address.name,
              },
            })
          : await this.epaycoService.createCardCharge({
              tokenCard: dto.paymentDetails!.card!.cardToken,
              customerEmail,
              amount: grandTotal,
              tax: 0,
              taxBase: grandTotal,
              description: `Pedido ${referenceCode}`,
              invoice: referenceCode,
              installments: dto.paymentDetails!.card!.installments ?? 1,
              name: dto.address.name,
              address: dto.address.address,
              phone: dto.address.phone,
              city: dto.address.city,
            })
        : null;

    // Bre-B: pago manual por transferencia — el cliente transfiere y el admin verifica
    const brebTransaction = null;

    const isApprovedCardPayment =
      cardProvider === 'wompi'
        ? cardTransaction?.status === 'APPROVED'
        : ['Aceptada', 'Aprobada', 'APPROVED', 'approved'].includes(
            String(cardTransaction?.status ?? cardTransaction?.respuesta ?? ''),
          );
    const orderStatus =
      dto.paymentMethod === 'efectivo'
        ? 'created'
        : isApprovedCardPayment
          ? 'paid'
          : 'payment_pending';
    const paymentIntentStatus =
      dto.paymentMethod === 'efectivo'
        ? 'pending'
        : isApprovedCardPayment
          ? 'authorized'
          : 'pending';
    const paymentStatus =
      dto.paymentMethod === 'efectivo'
        ? 'PENDING'
        : isApprovedCardPayment
          ? 'COMPLETED'
          : 'PENDING';

    const result = await this.drizzleService.transaction(async (tx) => {
      // Punto del destino. Sin coordenadas no hay ruta que pintar en ningún
      // mapa (seguimiento del cliente, mapa del repartidor y mapa de flota).
      const addressPoint =
        dto.address.lat != null && dto.address.lng != null
          ? `POINT(${dto.address.lng} ${dto.address.lat})`
          : null;

      // Dirección guardada solo para clientes registrados (customerAddresses
      // exige customerId). Los invitados guardan sus datos en orders + shipments.
      let customerAddressId: number | null = null;
      if (saveAddress && customerId != null) {
        const insertedAddresses = await tx
          .insert(customerAddresses)
          .values({
            customerId,
            addressLine1: dto.address.address,
            city: dto.address.city,
            country: 'Colombia',
            reference: dto.address.name,
            deliveryInstructions: dto.address.notes,
            location: addressPoint,
          })
          .returning({ id: customerAddresses.id });
        customerAddressId = Number(insertedAddresses[0].id);
      }

      const insertedOrders = await tx
        .insert(orders)
        .values({
          referenceCode,
          customerId,
          guestSessionId,
          branchId: Number(branch.id),
          customerAddressId,
          status: orderStatus,
          currencyCode: 'COP',
          subtotal: String(subtotal),
          shippingCost: String(shippingCost),
          grandTotal: String(grandTotal),
          notes: dto.address.notes,
          customerName,
          customerPhone,
          customerEmail,
        })
        .returning({ id: orders.id, referenceCode: orders.referenceCode });

      const orderId = Number(insertedOrders[0].id);

      await tx.insert(orderItems).values(
        normalizedItems.map((item) => ({
          orderId,
          productVariantId: item.productVariantId,
          productName: item.productName,
          variantSku: item.variantSku,
          quantity: item.quantity,
          unitPriceNet: String(item.unitPrice),
          unitPriceGross: String(item.unitPrice),
          subtotal: String(item.subtotal),
          total: String(item.subtotal),
        })),
      );

      await tx.insert(shipments).values({
        orderId,
        addressLine1: dto.address.address,
        city: dto.address.city,
        recipientName: dto.address.name,
        recipientPhone: dto.address.phone,
        location: addressPoint,
        status: 'PENDING',
      });

      const insertedPaymentIntent = await tx
        .insert(paymentIntents)
        .values({
          orderId,
          paymentMethod: this.mapPaymentMethod(dto.paymentMethod),
          status: paymentIntentStatus,
          amount: String(grandTotal),
          currency: 'COP',
          providerName: this.mapPaymentProvider(dto.paymentMethod),
          providerTransactionId:
            cardTransaction?.id?.toString() ??
            cardTransaction?.ref_payco?.toString() ??
            `pi_${referenceCode}`,
          providerResponse: {
            paymentMethod: dto.paymentMethod,
            simulated: dto.paymentMethod !== 'tarjeta',
            provider:
              dto.paymentMethod === 'tarjeta'
                ? cardProvider
                : this.mapPaymentProvider(dto.paymentMethod),
            shippingType: dto.shippingType,
            paymentDetails: this.buildPaymentResponse(dto),
            cardTransaction,
            brebTransaction,
          },
          idempotencyKey: `checkout-${referenceCode}`,
        })
        .returning({ id: paymentIntents.id });

      await tx.insert(payments).values({
        orderId,
        paymentIntentId: Number(insertedPaymentIntent[0].id),
        providerTransactionId:
          cardTransaction?.id?.toString() ??
          cardTransaction?.ref_payco?.toString() ??
          `pay_${referenceCode}`,
        providerName: this.mapPaymentProvider(dto.paymentMethod),
        amount: String(grandTotal),
        currency: 'COP',
        paymentMethod: this.mapPaymentMethod(dto.paymentMethod),
        status: paymentStatus,
      });

      await tx.insert(orderStatusHistory).values({
        orderId,
        status: orderStatus,
        note: `Pedido creado desde ecommerce con pago ${dto.paymentMethod}`,
        createdBy: customerId ?? null,
      });

      return {
        orderId,
        referenceCode: insertedOrders[0].referenceCode,
        subtotal,
        shippingCost,
        grandTotal,
        paymentMethod: dto.paymentMethod,
        shippingType: dto.shippingType,
        address: dto.address,
        status: orderStatus,
        cardTransaction,
      };
    });

    if (dto.paymentMethod === 'tarjeta' && orderStatus === 'payment_pending') {
      this.paymentVerification.verifyAndNotify(
        result.orderId,
        result.referenceCode,
        result.cardTransaction,
      );
    }

    // El pedido acaba de entrar a la cola de alistamiento: se avisa por WebSocket
    // a los paneles y a los pickers móviles, que si no esperarían a su sondeo.
    this.ordersGateway.notifyOrderStatus(
      result.referenceCode,
      this.mapOrderStatus(orderStatus),
      { customerId },
    );

    // Push a los pickers: la app puede estar en segundo plano o cerrada. Es
    // best-effort (si falla, el aviso en vivo por WebSocket sigue funcionando).
    void this.pushService.sendToPickers({
      title: 'Nuevo pedido 🛒',
      body: `Pedido ${result.referenceCode} listo para alistar.`,
      data: {
        type: 'ORDER',
        orderId: String(result.orderId),
        referenceCode: result.referenceCode,
      },
      channelId: 'picking-alerts',
    });

    // Notificar al cliente registrado (los invitados ven el código en pantalla)
    if (customerId != null) {
      await this.notificationsService.create({
        type: 'ORDER',
        title:
          orderStatus === 'payment_pending'
            ? 'Pedido recibido - Pago pendiente'
            : 'Pedido confirmado',
        message:
          orderStatus === 'payment_pending'
            ? `Tu pedido ${result.referenceCode} está pendiente de confirmación de pago. Te notificaremos cuando se apruebe.`
            : `Tu pedido ${result.referenceCode} ha sido registrado y será procesado pronto.`,
        targetCustomerId: customerId,
        linkUrl: `/account?tab=orders`,
      });
    }

    return result;
  }

  /**
   * Consulta pública de un pedido por su código de referencia (sin sesión).
   */
  async trackOrder(referenceCode: string) {
    const code = (referenceCode || '').trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('Ingresa el código del pedido');
    }

    const [row] = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        status: orders.status,
        shippingCost: orders.shippingCost,
        grandTotal: orders.grandTotal,
        createdAt: orders.createdAt,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        paymentMethod: payments.paymentMethod,
      })
      .from(orders)
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .where(eq(orders.referenceCode, code))
      .limit(1);

    if (!row) {
      throw new NotFoundException(
        `No encontramos el pedido ${code}. Verifica el código e intenta de nuevo.`,
      );
    }

    const [shipment] = await this.db
      .select({
        addressLine1: shipments.addressLine1,
        city: shipments.city,
        recipientName: shipments.recipientName,
        recipientPhone: shipments.recipientPhone,
      })
      .from(shipments)
      .where(eq(shipments.orderId, Number(row.id)))
      .limit(1);

    const itemRows = await this.db
      .select({
        productName: orderItems.productName,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPriceNet,
        productVariantId: orderItems.productVariantId,
        image: media.path,
      })
      .from(orderItems)
      .leftJoin(
        productVariants,
        eq(productVariants.id, orderItems.productVariantId),
      )
      .leftJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        productImages,
        and(
          eq(productImages.productId, products.id),
          eq(productImages.isCover, true),
        ),
      )
      .leftJoin(media, eq(media.id, productImages.mediaId))
      .where(eq(orderItems.orderId, Number(row.id)))
      .orderBy(asc(orderItems.id));

    const mappedStatus = this.mapOrderStatus(row.status);

    return {
      id: row.referenceCode,
      date: row.createdAt ?? '',
      items: itemRows.map((it) => ({
        id: it.productName,
        name: it.productName,
        image: it.image ?? null,
        quantity: Number(it.quantity ?? 1),
        price: Number(it.unitPrice ?? 0),
        category: '',
      })),
      total: Number(row.grandTotal ?? 0),
      shipping: Number(row.shippingCost ?? 0),
      address: shipment
        ? [shipment.addressLine1, shipment.city].filter(Boolean).join(', ')
        : '',
      paymentMethod: this.reverseMapPaymentMethod(row.paymentMethod),
      status: mappedStatus,
      customerName: row.customerName ?? shipment?.recipientName ?? null,
      customerPhone: row.customerPhone ?? shipment?.recipientPhone ?? null,
    };
  }

  /** Resuelve el pedido por su código público (secreto compartido con el cliente). */
  private async resolveOrderByCode(referenceCode: string) {
    const code = (referenceCode || '').trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('Ingresa el código del pedido');
    }

    const [row] = await this.db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        guestSessionId: orders.guestSessionId,
      })
      .from(orders)
      .where(eq(orders.referenceCode, code))
      .limit(1);

    if (!row) {
      throw new NotFoundException(
        `No encontramos el pedido ${code}. Verifica el código e intenta de nuevo.`,
      );
    }

    return row;
  }

  /**
   * Mensajes del chat del pedido (cliente ↔ repartidor), por código público.
   * No marca nada como leído: de eso se encarga `markChatMessagesRead`, para
   * que el sondeo del badge de no leídos no borre el aviso sin abrir el chat.
   */
  async getChatMessages(referenceCode: string) {
    const order = await this.resolveOrderByCode(referenceCode);

    const rows = await this.db
      .select({
        id: orderChatMessages.id,
        senderType: orderChatMessages.senderType,
        body: orderChatMessages.body,
        createdAt: orderChatMessages.createdAt,
        readAt: orderChatMessages.readAt,
      })
      .from(orderChatMessages)
      .where(eq(orderChatMessages.orderId, order.id))
      // Los más recientes primero para que el límite recorte el historial
      // viejo, no los mensajes nuevos; luego se invierte a orden cronológico.
      .orderBy(desc(orderChatMessages.id))
      .limit(300);

    return rows.reverse().map((r) => ({
      id: String(r.id),
      senderType: r.senderType,
      body: r.body,
      createdAt: toIsoTimestamp(r.createdAt),
      readAt: toIsoTimestamp(r.readAt),
    }));
  }

  /**
   * Acuse de lectura del cliente: sella los mensajes que le escribió el
   * repartidor y que aún no tenían visto. Así el repartidor ve el doble check.
   */
  async markChatMessagesRead(referenceCode: string) {
    const order = await this.resolveOrderByCode(referenceCode);

    const updated = await this.db
      .update(orderChatMessages)
      .set({ readAt: new Date().toISOString() })
      .where(
        and(
          eq(orderChatMessages.orderId, order.id),
          eq(orderChatMessages.senderType, 'delivery'),
          isNull(orderChatMessages.readAt),
        ),
      )
      .returning({ id: orderChatMessages.id });

    return { updated: updated.length };
  }

  /** Envía un mensaje del cliente en el chat del pedido (público por código). */
  async sendChatMessage(referenceCode: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) {
      throw new BadRequestException('Escribe un mensaje.');
    }
    if (text.length > 2000) {
      throw new BadRequestException('El mensaje no puede superar 2000 caracteres.');
    }

    const order = await this.resolveOrderByCode(referenceCode);
    await this.assertChatActive(order.id);

    const [row] = await this.db
      .insert(orderChatMessages)
      .values({
        orderId: order.id,
        senderType: 'customer',
        // La identidad del cliente vive en la orden (customer_id / guest_session_id),
        // no en users; aquí solo se conserva la sesión invitado si la hubo.
        senderUserId: null,
        senderGuestSessionId: order.guestSessionId ?? null,
        body: text,
      })
      .returning();

    // Push al repartidor asignado: la app puede estar en segundo plano o cerrada.
    // Best-effort; si no hay repartidor activo, no se manda nada.
    void this.pushCustomerMessageToDriver(order.id, text).catch(() => undefined);

    return {
      id: String(row.id),
      senderType: row.senderType,
      body: row.body,
      createdAt: toIsoTimestamp(row.createdAt),
      readAt: toIsoTimestamp(row.readAt),
    };
  }

  /**
   * Avisa por push al repartidor con asignación activa del pedido de un mensaje
   * nuevo del cliente. Best-effort: no lanza y, sin repartidor asignado, no hace
   * nada. `sendToDriver` espera el id de `delivery_drivers`.
   */
  private async pushCustomerMessageToDriver(orderId: bigint, body: string) {
    const [assignment] = await this.db
      .select({ driverId: deliveryAssignments.driverId })
      .from(deliveryAssignments)
      .innerJoin(shipments, eq(shipments.id, deliveryAssignments.shipmentId))
      .where(
        and(
          eq(shipments.orderId, Number(orderId)),
          inArray(deliveryAssignments.status, [
            'ASSIGNED',
            'ACCEPTED',
            'READY_FOR_PICKUP',
            'PICKED_UP',
            'IN_DELIVERY',
          ]),
        ),
      )
      .orderBy(desc(deliveryAssignments.id))
      .limit(1);

    if (!assignment) return;

    await this.pushService.sendToDriver(assignment.driverId, {
      title: 'Mensaje del cliente',
      body: truncatePushBody(body),
      data: { type: 'customer-chat', orderId: String(orderId) },
    });
  }

  /**
   * El chat solo se puede escribir mientras la entrega está en camino.
   * La lectura sigue disponible después (historial del pedido).
   */
  private async assertChatActive(orderId: bigint) {
    const [assignment] = await this.db
      .select({ status: deliveryAssignments.status })
      .from(deliveryAssignments)
      .innerJoin(shipments, eq(shipments.id, deliveryAssignments.shipmentId))
      .where(
        and(
          eq(shipments.orderId, Number(orderId)),
          // El estado relevante es el de la asignación vigente (no las
          // ofertas del pool que quedaron canceladas/rechazadas).
          inArray(deliveryAssignments.status, [
            'ASSIGNED',
            'ACCEPTED',
            'READY_FOR_PICKUP',
            'PICKED_UP',
            'IN_DELIVERY',
            'DELIVERED',
          ]),
        ),
      )
      .orderBy(desc(deliveryAssignments.id))
      .limit(1);

    if (
      !assignment ||
      !CHAT_ACTIVE_STATUSES.includes(
        assignment.status as (typeof CHAT_ACTIVE_STATUSES)[number],
      )
    ) {
      throw new ConflictException(
        'El chat está disponible solo mientras el pedido está en camino.',
      );
    }
  }

  /**
   * Seguimiento en vivo de la entrega (público por código, sin sesión):
   * repartidor (posición), destino y sucursal para pintar el mapa del cliente.
   */
  async getLiveTracking(referenceCode: string) {
    const code = (referenceCode || '').trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('Ingresa el código del pedido');
    }

    const [order] = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        status: orders.status,
        branchId: orders.branchId,
      })
      .from(orders)
      .where(eq(orders.referenceCode, code))
      .limit(1);
    if (!order) {
      throw new NotFoundException(
        `No encontramos el pedido ${code}. Verifica el código e intenta de nuevo.`,
      );
    }
    const orderId = Number(order.id);

    const [shipment] = await this.db
      .select({
        id: shipments.id,
        addressLine1: shipments.addressLine1,
        city: shipments.city,
        location: shipments.location,
      })
      .from(shipments)
      .where(eq(shipments.orderId, orderId))
      .limit(1);
    if (!shipment) {
      throw new NotFoundException('El pedido no tiene envío asociado.');
    }

    const [assignment] = await this.db
      .select({
        status: deliveryAssignments.status,
        inDeliveryAt: deliveryAssignments.inDeliveryAt,
        completedAt: deliveryAssignments.completedAt,
        driverId: deliveryAssignments.driverId,
      })
      .from(deliveryAssignments)
      .where(
        and(
          eq(deliveryAssignments.shipmentId, Number(shipment.id)),
          // Ignora ofertas canceladas/rechazadas del pool: la más reciente
          // relevante refleja quién tiene realmente el pedido.
          inArray(deliveryAssignments.status, [
            'ASSIGNED',
            'ACCEPTED',
            'READY_FOR_PICKUP',
            'PICKED_UP',
            'IN_DELIVERY',
            'DELIVERED',
          ]),
        ),
      )
      .orderBy(desc(deliveryAssignments.id))
      .limit(1);

    let driver: {
      name: string;
      avatarUrl: string | null;
      vehicleType: string | null;
      vehiclePlate: string | null;
      location: { lat: number; lng: number } | null;
      lastLocationAt: string | null;
    } | null = null;
    if (assignment?.driverId != null) {
      const [d] = await this.db
        .select({
          fullName: deliveryDrivers.fullName,
          avatarUrl: deliveryDrivers.avatarUrl,
          vehicleType: deliveryDrivers.vehicleType,
          vehiclePlate: deliveryDrivers.vehiclePlate,
          currentLocation: deliveryDrivers.currentLocation,
          lastLocationAt: deliveryDrivers.lastLocationAt,
        })
        .from(deliveryDrivers)
        .where(eq(deliveryDrivers.id, BigInt(assignment.driverId)))
        .limit(1);
      if (d) {
        driver = {
          name: d.fullName,
          avatarUrl: d.avatarUrl ?? null,
          vehicleType: d.vehicleType,
          vehiclePlate: d.vehiclePlate,
          location: this.parseDbPoint(d.currentLocation),
          lastLocationAt: d.lastLocationAt ?? null,
        };
      }
    }

    let branch: {
      name: string;
      address: string | null;
      location: { lat: number; lng: number } | null;
    } | null = null;
    if (order.branchId != null) {
      const [b] = await this.db
        .select({
          name: branches.name,
          address: branches.address,
          location: branches.location,
        })
        .from(branches)
        .where(eq(branches.id, BigInt(order.branchId)))
        .limit(1);
      if (b) {
        branch = {
          name: b.name,
          address: b.address,
          location: this.parseDbPoint(b.location),
        };
      }
    }

    return {
      referenceCode: order.referenceCode,
      status: this.mapOrderStatus(order.status),
      deliveryStatus: assignment?.status ?? null,
      driver,
      branch,
      destination: {
        address: [shipment.addressLine1, shipment.city]
          .filter(Boolean)
          .join(', '),
        location: this.parseDbPoint(shipment.location),
      },
      updatedAt: driver?.lastLocationAt ?? null,
    };
  }

  /**
   * Ruta por calles (OSRM) entre el repartidor y el domicilio del cliente,
   * para el mapa público de seguimiento. Devuelve `null` si aún no hay datos
   * (sin repartidor, sin coordenadas o motor de rutas caído).
   */
  async getLiveRoute(referenceCode: string): Promise<LiveRoute | null> {
    const code = (referenceCode || '').trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('Ingresa el código del pedido');
    }

    const cached = this.liveRouteCache.get(code);
    if (cached && Date.now() - cached.at < LIVE_ROUTE_TTL_MS) return cached.data;

    const data = await this.computeLiveRoute(code);
    this.liveRouteCache.set(code, { at: Date.now(), data });
    return data;
  }

  private async computeLiveRoute(code: string): Promise<LiveRoute | null> {
    const [order] = await this.db
      .select({ id: orders.id, branchId: orders.branchId })
      .from(orders)
      .where(eq(orders.referenceCode, code))
      .limit(1);
    if (!order) {
      throw new NotFoundException(
        `No encontramos el pedido ${code}. Verifica el código e intenta de nuevo.`,
      );
    }

    const [shipment] = await this.db
      .select({ id: shipments.id, location: shipments.location })
      .from(shipments)
      .where(eq(shipments.orderId, Number(order.id)))
      .limit(1);
    const destination = this.parseDbPoint(shipment?.location);
    if (!shipment || !destination) return null;

    // Origen: última posición del repartidor asignado; si no, la sucursal.
    let origin: { lat: number; lng: number } | null = null;
    const [assignment] = await this.db
      .select({ driverId: deliveryAssignments.driverId })
      .from(deliveryAssignments)
      .where(eq(deliveryAssignments.shipmentId, Number(shipment.id)))
      .orderBy(desc(deliveryAssignments.id))
      .limit(1);
    if (assignment?.driverId != null) {
      const [d] = await this.db
        .select({ currentLocation: deliveryDrivers.currentLocation })
        .from(deliveryDrivers)
        .where(eq(deliveryDrivers.id, BigInt(assignment.driverId)))
        .limit(1);
      origin = this.parseDbPoint(d?.currentLocation);
    }
    if (!origin && order.branchId != null) {
      const [b] = await this.db
        .select({ location: branches.location })
        .from(branches)
        .where(eq(branches.id, BigInt(order.branchId)))
        .limit(1);
      origin = this.parseDbPoint(b?.location);
    }
    if (!origin) return null;

    const url =
      `${OSRM_URL}/route/v1/car/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
      `?overview=full&geometries=polyline&alternatives=false`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const payload = (await res.json()) as {
        routes?: Array<{ geometry?: string; distance?: number; duration?: number }>;
      };
      const route = payload?.routes?.[0];
      if (!route?.geometry) return null;
      return {
        polyline: route.geometry,
        distanceM: Number(route.distance ?? 0),
        durationS: Number(route.duration ?? 0),
      };
    } catch {
      return null;
    }
  }

  /** Parsea un punto postgis/EWKT ('POINT(lng lat)') si viene como texto. */
  private parseDbPoint(value: string | null | undefined): { lat: number; lng: number } | null {
    return parsePointText(value);
  }

  async getOrders(customerId: number) {
    const orderRows = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        status: orders.status,
        subtotal: orders.subtotal,
        shippingCost: orders.shippingCost,
        grandTotal: orders.grandTotal,
        createdAt: orders.createdAt,
        addressLine1: customerAddresses.addressLine1,
        addressLine2: customerAddresses.addressLine2,
        city: customerAddresses.city,
        paymentMethod: payments.paymentMethod,
      })
      .from(orders)
      .leftJoin(
        customerAddresses,
        eq(customerAddresses.id, orders.customerAddressId),
      )
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt));

    if (!orderRows.length) return [];

    // Deduplicar por id del pedido (el JOIN con payments puede multiplicar filas)
    const dedupMap = new Map<string, (typeof orderRows)[number]>();
    for (const row of orderRows) {
      const key = String(row.id);
      if (!dedupMap.has(key)) dedupMap.set(key, row);
    }
    const uniqueRows = [...dedupMap.values()];

    const orderIds = uniqueRows.map((r) => Number(r.id));

    const itemRows = await this.db
      .select({
        orderId: orderItems.orderId,
        productName: orderItems.productName,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPriceNet,
        total: orderItems.total,
        variantSku: orderItems.variantSku,
        productVariantId: orderItems.productVariantId,
        image: media.path,
      })
      .from(orderItems)
      .leftJoin(
        productVariants,
        eq(productVariants.id, orderItems.productVariantId),
      )
      .leftJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        productImages,
        and(
          eq(productImages.productId, products.id),
          eq(productImages.isCover, true),
        ),
      )
      .leftJoin(media, eq(media.id, productImages.mediaId))
      .where(inArray(orderItems.orderId, orderIds))
      .orderBy(asc(orderItems.id));

    const itemsByOrderId = new Map<number, typeof itemRows>();
    for (const item of itemRows) {
      const oid = Number(item.orderId);
      const list = itemsByOrderId.get(oid) ?? [];
      list.push(item);
      itemsByOrderId.set(oid, list);
    }

    return uniqueRows.map((row) => {
      const items = (itemsByOrderId.get(Number(row.id)) ?? []).map((item) => ({
        name: item.productName,
        price: Number(item.unitPrice ?? 0),
        quantity: Number(item.quantity ?? 1),
        total: Number(item.total ?? 0),
        image: item.image ?? null,
        unit: 'unidad',
        category: '',
      }));

      const address = [row.addressLine1, row.addressLine2, row.city]
        .filter(Boolean)
        .join(', ');

      return {
        id: row.referenceCode,
        date: row.createdAt ?? '',
        items,
        total: Number(row.grandTotal ?? 0),
        shipping: Number(row.shippingCost ?? 0),
        address,
        paymentMethod: this.reverseMapPaymentMethod(row.paymentMethod),
        status: this.mapOrderStatus(row.status),
      };
    });
  }

  private reverseMapPaymentMethod(method: string | null) {
    switch (method) {
      case 'CARD':
        return 'tarjeta';
      case 'PSE':
        return 'pse';
      case 'CASH':
        return 'efectivo';
      case 'NEQUI':
        return 'nequi';
      case 'BREB':
        return 'breb';
      case 'DAVIPLATA':
        return 'daviplata';
      case 'BANK_TRANSFER':
        return 'efectivo';
      default:
        return 'efectivo';
    }
  }

  private mapOrderStatus(status: string | null) {
    switch (status) {
      case 'created':
        return 'pendiente';
      case 'confirmed':
        return 'preparando';
      case 'payment_pending':
        return 'pendiente';
      case 'paid':
        return 'preparando';
      case 'preparing':
        return 'preparando';
      case 'ready':
        return 'listo';
      case 'shipped':
        return 'en camino';
      case 'delivered':
        return 'entregado';
      case 'cancelled':
        return 'cancelado';
      default:
        return 'pendiente';
    }
  }

  private async getCustomer(customerId: number) {
    const result = await this.db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
      })
      .from(customers)
      .where(eq(customers.id, BigInt(customerId)))
      .limit(1);

    if (!result.length) {
      throw new NotFoundException(`Cliente con ID ${customerId} no encontrado`);
    }

    return result[0];
  }

  private validatePaymentDetails(dto: CreateOrderDto) {
    if (dto.paymentMethod === 'tarjeta') {
      const card = dto.paymentDetails?.card;
      if (
        !card?.cardholderName ||
        !card.cardToken ||
        !card.last4 ||
        !card.brand ||
        (card.provider === 'wompi' &&
          (!card.acceptanceToken || !card.acceptPersonalAuth))
      ) {
        throw new BadRequestException(
          'Debes completar y tokenizar los datos de la tarjeta',
        );
      }
    }

    if (dto.paymentMethod === 'pse') {
      const pse = dto.paymentDetails?.pse;
      if (!pse?.bank || !pse.personType) {
        throw new BadRequestException(
          'Debes seleccionar banco y tipo de persona para PSE',
        );
      }
    }

    if (dto.paymentMethod === 'nequi') {
      const nequi = dto.paymentDetails?.nequi;
      if (!nequi?.phone) {
        throw new BadRequestException(
          'Debes ingresar el número asociado a Nequi',
        );
      }
    }
  }

  private buildPaymentResponse(dto: CreateOrderDto) {
    if (dto.paymentMethod === 'tarjeta') {
      const card = dto.paymentDetails?.card;
      return {
        provider: card?.provider ?? 'epayco',
        cardholderName: card?.cardholderName,
        last4: card?.last4,
        brand: card?.brand,
        installments: card?.installments ?? 1,
      };
    }

    if (dto.paymentMethod === 'pse') {
      return dto.paymentDetails?.pse;
    }

    if (dto.paymentMethod === 'nequi') {
      return {
        phone: dto.paymentDetails?.nequi?.phone,
      };
    }

    return null;
  }

  private async getDefaultBranch() {
    const result = await this.db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.isActive, true), isNull(branches.deletedAt)))
      .orderBy(asc(branches.priority), asc(branches.id))
      .limit(1);

    if (!result.length) {
      throw new NotFoundException('No hay sucursales activas configuradas');
    }

    return result[0];
  }

  private buildReferenceCode() {
    return `MER-${Date.now().toString().slice(-8)}`;
  }

  private mapPaymentMethod(method: CreateOrderDto['paymentMethod']) {
    switch (method) {
      case 'tarjeta':
        return 'CARD';
      case 'pse':
        return 'PSE';
      case 'nequi':
        return 'NEQUI';
      case 'breb':
        return 'BREB';
      default:
        return 'CASH';
    }
  }

  private mapPaymentProvider(method: CreateOrderDto['paymentMethod']) {
    switch (method) {
      case 'tarjeta':
        return 'card_gateway';
      case 'pse':
        return 'pse';
      case 'nequi':
        return 'nequi';
      case 'breb':
        return 'breb';
      default:
        return 'cash';
    }
  }

  // ── Admin methods ──

  async getAllOrders(filters?: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions: any[] = [];

    if (filters?.status) {
      const dbStatus = this.adminMapStatusToDb(filters.status);
      if (dbStatus) {
        conditions.push(
          eq(
            orders.status,
            dbStatus as (typeof orders.status.enumValues)[number],
          ),
        );
      }
    }

    if (filters?.search) {
      const s = `%${filters.search}%`;
      conditions.push(
        or(
          like(orders.referenceCode, s),
          like(customers.firstName, s),
          like(customers.lastName, s),
          like(customers.email, s),
        ),
      );
    }

    const query = this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        status: orders.status,
        subtotal: orders.subtotal,
        shippingCost: orders.shippingCost,
        grandTotal: orders.grandTotal,
        notes: orders.notes,
        createdAt: orders.createdAt,
        customerId: orders.customerId,
        customerName: sql<string>`CONCAT(${customers.firstName}, ' ', ${customers.lastName})`,
        customerEmail: customers.email,
        customerPhone: customers.phone,
        addressLine1: customerAddresses.addressLine1,
        addressLine2: customerAddresses.addressLine2,
        city: customerAddresses.city,
        paymentMethod: payments.paymentMethod,
        paymentStatus: payments.status,
        pickedAt: orders.pickedAt,
        completedAt: orders.completedAt,
        pickerName: sql<string>`NULLIF(TRIM(CONCAT(${users.firstName}, ' ', ${users.lastName})), '')`,
        driverName: sql<string>`(SELECT dd.full_name FROM delivery_assignments da JOIN shipments s ON s.id = da.shipment_id JOIN delivery_drivers dd ON dd.id = da.driver_id WHERE s.order_id = ${orders.id} ORDER BY da.id DESC LIMIT 1)`,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(
        customerAddresses,
        eq(customerAddresses.id, orders.customerAddressId),
      )
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .leftJoin(users, eq(users.id, orders.pickerId));

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    query.orderBy(desc(orders.createdAt));

    if (filters?.limit) {
      query.limit(filters.limit);
    }
    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const rows = await query;

    // Deduplicar por id del pedido (el JOIN con payments puede multiplicar filas)
    const dedupMap = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = String(row.id);
      if (!dedupMap.has(key)) dedupMap.set(key, row);
    }
    const uniqueRows = [...dedupMap.values()];

    // Get item counts per order
    const orderIds = uniqueRows.map((r) => Number(r.id));
    const itemCounts = new Map<number, number>();
    const itemProgress = new Map<
      number,
      { pieces: number; scanned: number; remaining: number }
    >();
    if (orderIds.length > 0) {
      const countRows = await this.db
        .select({
          orderId: orderItems.orderId,
          count: sql<number>`COUNT(*)::int`,
          pieces: sql<number>`COALESCE(SUM(${orderItems.quantity}),0)::int`,
          scanned: sql<number>`COALESCE(SUM(${orderItems.pickedQty}),0)::int`,
          remaining: sql<number>`COUNT(*) FILTER (WHERE ${orderItems.pickedQty} < ${orderItems.quantity})::int`,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))
        .groupBy(orderItems.orderId);
      for (const cr of countRows) {
        itemCounts.set(Number(cr.orderId), Number(cr.count));
        itemProgress.set(Number(cr.orderId), {
          pieces: cr.pieces,
          scanned: cr.scanned,
          remaining: cr.remaining,
        });
      }
    }

    return uniqueRows.map((row) => {
      const prog = itemProgress.get(Number(row.id));
      const pieces = prog?.pieces ?? 0;
      const scanned = prog?.scanned ?? 0;
      return {
      id: row.referenceCode,
      orderId: Number(row.id),
      customer: row.customerName ?? row.customerEmail ?? 'Cliente',
      phone: row.customerPhone ?? '',
      address: [row.addressLine1, row.addressLine2, row.city]
        .filter(Boolean)
        .join(', '),
      total: Number(row.grandTotal ?? 0),
      payment: this.reverseMapPaymentMethod(row.paymentMethod),
      status: this.mapOrderStatus(row.status),
      itemsCount: itemCounts.get(Number(row.id)) ?? 0,
      date: row.createdAt
        ? new Date(row.createdAt).toISOString().split('T')[0]
        : '',
      time: row.createdAt
        ? new Date(row.createdAt).toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
      note: row.notes ?? undefined,
      pickerName: row.pickerName ?? null,
      driverName: row.driverName ?? null,
      // Progreso y tiempos de alistamiento (picking)
      pickedAt: row.pickedAt,
      completedAt: row.completedAt,
      totalPieces: pieces,
      scannedPieces: scanned,
      remainingPieces: Math.max(0, pieces - scanned),
      remainingItems: prog?.remaining ?? 0,
    };
    });
  }

  async getOrderById(orderId: number) {
    const row = await this.db
      .select({
        id: orders.id,
        referenceCode: orders.referenceCode,
        status: orders.status,
        subtotal: orders.subtotal,
        shippingCost: orders.shippingCost,
        grandTotal: orders.grandTotal,
        notes: orders.notes,
        createdAt: orders.createdAt,
        customerId: orders.customerId,
        customerName: sql<string>`CONCAT(${customers.firstName}, ' ', ${customers.lastName})`,
        customerEmail: customers.email,
        customerPhone: customers.phone,
        addressLine1: customerAddresses.addressLine1,
        addressLine2: customerAddresses.addressLine2,
        city: customerAddresses.city,
        paymentMethod: payments.paymentMethod,
        pickerName: sql<string>`NULLIF(TRIM(CONCAT(${users.firstName}, ' ', ${users.lastName})), '')`,
        driverName: sql<string>`(SELECT dd.full_name FROM delivery_assignments da JOIN shipments s ON s.id = da.shipment_id JOIN delivery_drivers dd ON dd.id = da.driver_id WHERE s.order_id = ${orders.id} ORDER BY da.id DESC LIMIT 1)`,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(
        customerAddresses,
        eq(customerAddresses.id, orders.customerAddressId),
      )
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .leftJoin(users, eq(users.id, orders.pickerId))
      .where(eq(orders.id, BigInt(orderId)))
      .limit(1);

    if (!row.length) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const o = row[0];

    // Get items
    const items = await this.db
      .select({
        productName: orderItems.productName,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPriceNet,
        total: orderItems.total,
        variantSku: orderItems.variantSku,
        image: media.path,
      })
      .from(orderItems)
      .leftJoin(
        productVariants,
        eq(productVariants.id, orderItems.productVariantId),
      )
      .leftJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        productImages,
        and(
          eq(productImages.productId, products.id),
          eq(productImages.isCover, true),
        ),
      )
      .leftJoin(media, eq(media.id, productImages.mediaId))
      .where(eq(orderItems.orderId, Number(orderId)))
      .orderBy(asc(orderItems.id));

    // Get status history
    const history = await this.db
      .select({
        status: orderStatusHistory.status,
        note: orderStatusHistory.note,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, Number(orderId)))
      .orderBy(asc(orderStatusHistory.createdAt));

    return {
      id: o.referenceCode,
      customer: o.customerName ?? o.customerEmail ?? 'Cliente',
      phone: o.customerPhone ?? '',
      address: [o.addressLine1, o.addressLine2, o.city]
        .filter(Boolean)
        .join(', '),
      items: items.map((item) => ({
        name: item.productName,
        qty: Number(item.quantity ?? 1),
        price: Number(item.unitPrice ?? 0),
      })),
      total: Number(o.grandTotal ?? 0),
      payment: this.reverseMapPaymentMethod(o.paymentMethod),
      status: this.mapOrderStatus(o.status),
      date: o.createdAt
        ? new Date(o.createdAt).toISOString().split('T')[0]
        : '',
      time: o.createdAt
        ? new Date(o.createdAt).toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
      note: o.notes ?? undefined,
      pickerName: o.pickerName ?? null,
      driverName: o.driverName ?? null,
      statusHistory: history.map((h) => ({
        status: this.mapOrderStatus(h.status),
        note: h.note ?? undefined,
        time: h.createdAt
          ? new Date(h.createdAt).toLocaleTimeString('es-CO', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
      })),
    };
  }

  async updateOrderStatus(orderId: number, newStatus: string) {
    const dbStatus = this.adminMapStatusToDb(newStatus);
    if (!dbStatus) {
      throw new BadRequestException(`Estado inválido: ${newStatus}`);
    }

    const [existing] = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        referenceCode: orders.referenceCode,
        customerId: orders.customerId,
      })
      .from(orders)
      .where(eq(orders.id, BigInt(orderId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException('Pedido no encontrado');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          status: dbStatus as (typeof orders.status.enumValues)[number],
          updatedAt: new Date().toISOString(),
        })
        .where(eq(orders.id, BigInt(orderId)));

      await tx.insert(orderStatusHistory).values({
        orderId,
        status: dbStatus as (typeof orders.status.enumValues)[number],
        oldStatus: existing.status,
        createdAt: new Date().toISOString(),
      });
    });

    // Emitir por WebSocket al cliente
    const displayStatus = this.mapOrderStatus(dbStatus);
    this.ordersGateway.notifyOrderStatus(existing.referenceCode, displayStatus, {
      customerId: existing.customerId,
    });

    // Notificar al cliente si el pago fue confirmado
    if (dbStatus === 'paid' && existing.customerId) {
      await this.notificationsService.create({
        type: 'ORDER',
        title: 'Pago confirmado',
        message: `El pago de tu pedido ${existing.referenceCode} ha sido confirmado. Ya estamos preparando tu pedido.`,
        targetCustomerId: Number(existing.customerId),
        linkUrl: `/account?tab=orders`,
      });
    }

    // Y avisarle cuando queda entregado (solo en la transición real, para no
    // repetir la notificación si vuelven a guardar el mismo estado).
    if (
      dbStatus === 'delivered' &&
      existing.status !== 'delivered' &&
      existing.customerId
    ) {
      await this.notificationsService.create({
        type: 'ORDER',
        title: 'Tu pedido fue entregado 🎉',
        message: `Tu pedido ${existing.referenceCode} llegó a su destino. ¡Gracias por comprar en Mercaldas!`,
        targetCustomerId: Number(existing.customerId),
        linkUrl: `order-track:${existing.referenceCode}`,
      });
    }

    return {
      success: true,
      status: displayStatus,
      orderId,
    };
  }

  async getUnreviewedCount(): Promise<{ count: number }> {
    const result = await this.db
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(orders)
      .where(isNull(orders.reviewedAt));

    return { count: Number(result[0]?.count ?? 0) };
  }

  async markAsReviewed(orderId: number) {
    const result = await this.db
      .update(orders)
      .set({ reviewedAt: new Date().toISOString() })
      .where(
        and(
          eq(orders.id, BigInt(orderId)),
          isNull(orders.reviewedAt),
        ),
      )
      .returning({ id: orders.id });

    return { reviewed: result.length > 0 };
  }

  private adminMapStatusToDb(status: string): string | null {
    switch (status) {
      case 'pendiente':
        return 'payment_pending';
      case 'confirmado':
        return 'paid';
      case 'preparando':
        return 'preparing';
      case 'listo':
        return 'ready';
      case 'en camino':
        return 'shipped';
      case 'entregado':
        return 'delivered';
      case 'cancelado':
        return 'cancelled';
      default:
        return null;
    }
  }
}
