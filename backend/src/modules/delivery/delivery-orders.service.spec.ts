import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryOrdersService } from './delivery-orders.service';
import { createDbMock } from '../../../test/helpers/db-mock';

function assignmentRow(overrides: Record<string, any> = {}) {
  return {
    assignment_id: '11',
    shipment_id: '21',
    order_id: '31',
    status: 'ASSIGNED',
    customer_id: '41',
    reference_code: 'MER-1',
    ...overrides,
  };
}

function orderRow(overrides: Record<string, any> = {}) {
  return {
    order_id: '31',
    reference_code: 'MER-1',
    notes: null,
    grand_total: '100.00',
    currency_code: 'COP',
    shipping_cost: '5000',
    customer_name: null,
    customer_phone: null,
    c_first_name: 'Lu',
    c_last_name: 'Pérez',
    c_phone: '3000000000',
    status: 'ASSIGNED',
    driver_id: '3',
    assigned_at: '2024-01-01T10:00:00.000Z',
    accepted_at: null,
    ready_for_pickup_at: null,
    picked_up_at: null,
    in_delivery_at: null,
    completed_at: null,
    rejected_at: null,
    failed_at: null,
    cancelled_at: null,
    reject_reason: null,
    cancel_reason: null,
    address_line1: 'Calle 1',
    address_line2: null,
    city: 'Medellín',
    location: 'POINT(-75.5 5.1)',
    branch_name: 'Centro',
    branch_address: 'Calle 2',
    branch_location: 'POINT(-75.6 5.0)',
    payment_method: 'CASH',
    assignment_id: '11',
    shipment_id: '21',
    ...overrides,
  };
}

describe('DeliveryOrdersService', () => {
  let mock: ReturnType<typeof createDbMock>;
  let gateway: {
    emitToDriver: ReturnType<typeof vi.fn>;
    emitFleetStatus: ReturnType<typeof vi.fn>;
    emitFleetChat: ReturnType<typeof vi.fn>;
  };
  let ordersGateway: { notifyOrderStatus: ReturnType<typeof vi.fn> };
  let notifications: { create: ReturnType<typeof vi.fn> };
  let pushService: { sendToDriver: ReturnType<typeof vi.fn> };
  let service: DeliveryOrdersService;

  /** Encola la consulta del pedido y la de sus ítems (fin de `transition`). */
  const queueOrderDetail = (row: Record<string, any> = orderRow()) => {
    mock.drizzle.execute.mockResolvedValueOnce([row]);
    mock.drizzle.execute.mockResolvedValueOnce([]);
  };

  beforeEach(() => {
    mock = createDbMock();
    gateway = {
      emitToDriver: vi.fn(),
      emitFleetStatus: vi.fn(),
      emitFleetChat: vi.fn(),
    };
    ordersGateway = { notifyOrderStatus: vi.fn() };
    notifications = { create: vi.fn().mockResolvedValue({}) };
    pushService = { sendToDriver: vi.fn().mockResolvedValue(undefined) };
    service = new DeliveryOrdersService(
      mock.drizzle as any,
      gateway as any,
      ordersGateway as any,
      notifications as any,
      pushService as any,
    );
  });

  describe('listados', () => {
    it('mapea los pedidos activos del repartidor', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([orderRow()])
        .mockResolvedValueOnce([
          {
            order_id: '31',
            product_name: 'Leche',
            quantity: '2',
            product_image: 'x.png',
          },
        ]);

      const orders = await service.listActive(3);

      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({
        id: 31,
        referenceCode: 'MER-1',
        status: 'ASSIGNED',
        customer: { name: 'Lu Pérez', phone: '3000000000' },
        address: { line1: 'Calle 1', city: 'Medellín' },
        destination: { lng: -75.5, lat: 5.1 },
        items: [{ name: 'Leche', quantity: 2, image: 'x.png' }],
        totals: { value: 100, currency: 'COP', shipping: 5000 },
        payment: { method: 'CASH', label: 'Contraentrega' },
        assignedToMe: true,
        timeline: [
          {
            event: 'ASSIGNED',
            at: '2024-01-01T10:00:00.000Z',
            description: null,
          },
        ],
      });
      expect(orders[0].pickup.branch).toEqual({
        name: 'Centro',
        address: 'Calle 2',
        lat: 5,
        lng: -75.6,
      });
      expect(mock.drizzle.execute.mock.calls[0][1]).toEqual([
        3,
        [
          'ASSIGNED',
          'ACCEPTED',
          'READY_FOR_PICKUP',
          'PICKED_UP',
          'IN_DELIVERY',
        ],
      ]);
    });

    it('marca assignedToMe=false si el pedido es de otro repartidor', async () => {
      queueOrderDetail(orderRow({ driver_id: '9' }));

      const orders = await service.listActive(3);

      expect(orders[0].assignedToMe).toBe(false);
    });

    it('deduplica las ofertas del pool prefiriendo la propia', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([
          orderRow({ driver_id: '9' }),
          orderRow({ driver_id: '3' }),
        ])
        .mockResolvedValueOnce([]);

      const orders = await service.listAvailable(3);

      expect(orders).toHaveLength(1);
      expect(orders[0].assignedToMe).toBe(true);
    });

    it('devuelve el historial del repartidor', async () => {
      mock.drizzle.execute
        .mockResolvedValueOnce([
          orderRow({
            status: 'DELIVERED',
            completed_at: '2024-01-02T10:00:00.000Z',
          }),
        ])
        .mockResolvedValueOnce([]);

      const history = await service.history(3);

      expect(history[0]).toMatchObject({
        status: 'DELIVERED',
        deliveredAt: '2024-01-02T10:00:00.000Z',
        completedAt: '2024-01-02T10:00:00.000Z',
      });
    });

    it('lanza 404 si el pedido no pertenece al repartidor', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await expect(service.getOrder(3, 31)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getVisibleOrder incluye los pedidos nuevos de otros repartidores', async () => {
      queueOrderDetail(orderRow({ driver_id: '9', status: 'ASSIGNED' }));

      const order = await service.getVisibleOrder(3, 31);

      expect(order.assignedToMe).toBe(false);
    });

    it('getVisibleOrder lanza 404 si no hay filas', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await expect(service.getVisibleOrder(3, 31)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('broadcastNewOrderToAllDrivers', () => {
    it('no hace nada si el pedido no tiene envío', async () => {
      mock.queueSelect([]);

      await service.broadcastNewOrderToAllDrivers(31, 'MER-1');

      expect(mock.state.inserts).toHaveLength(0);
      expect(gateway.emitToDriver).not.toHaveBeenCalled();
    });

    it('crea una oferta por repartidor activo y notifica a los nuevos', async () => {
      mock.queueSelectOne({ id: 1n });
      mock.queueSelect([
        { id: 10n, authUserId: 90n },
        { id: 11n, authUserId: 91n },
      ]);
      mock.queueSelect([]); // driver 10 sin oferta previa
      mock.queueSelect([{ id: 5n }]); // driver 11 ya tiene oferta

      await service.broadcastNewOrderToAllDrivers(31, 'MER-1');

      expect(mock.state.inserts).toHaveLength(1);
      expect(mock.state.inserts[0].values).toMatchObject({
        shipmentId: 1,
        driverId: 10,
        status: 'ASSIGNED',
        assignedAt: expect.any(String),
      });
      expect(gateway.emitToDriver).toHaveBeenCalledTimes(1);
      expect(gateway.emitToDriver).toHaveBeenCalledWith(
        90,
        'delivery:assigned',
        {
          orderId: 31,
          referenceCode: 'MER-1',
        },
      );
      expect(gateway.emitFleetStatus).toHaveBeenCalledWith({
        event: 'order-assigned',
        orderId: 31,
        referenceCode: 'MER-1',
        drivers: 1,
      });
      expect(pushService.sendToDriver).toHaveBeenCalledTimes(1);
      expect(pushService.sendToDriver).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          title: 'Nuevo pedido asignado',
          data: expect.objectContaining({ orderId: '31' }),
        }),
      );
    });

    it('no emite estado de flota si no hay repartidores a notificar', async () => {
      mock.queueSelectOne({ id: 1n });
      mock.queueSelect([]);
      mock.queueSelect([]);

      await service.broadcastNewOrderToAllDrivers(31, 'MER-1');

      expect(gateway.emitFleetStatus).not.toHaveBeenCalled();
      expect(pushService.sendToDriver).not.toHaveBeenCalled();
    });
  });

  describe('transition — validaciones', () => {
    it('lanza 404 si no hay asignación para el repartidor', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([]);

      await expect(service.transition(3, 31, 'accept')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mock.state.updates).toHaveLength(0);
    });

    it('rechaza acciones no permitidas por el estado actual', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([assignmentRow()]);

      await expect(service.transition(3, 31, 'deliver')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mock.state.updates).toHaveLength(0);
    });

    it('exige motivo al rechazar o fallar la entrega', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([assignmentRow()]);

      await expect(service.transition(3, 31, 'reject')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'IN_DELIVERY' }),
      ]);
      await expect(service.transition(3, 31, 'fail')).rejects.toThrow(
        'Debes indicar un motivo.',
      );
    });

    it('exige las dos fotos al confirmar la entrega', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'IN_DELIVERY' }),
      ]);

      await expect(
        service.transition(3, 31, 'deliver', {
          proofLocationUrl: 'https://cdn/lugar.jpg',
        }),
      ).rejects.toThrow(
        'La entrega requiere la foto del lugar y la foto del pedido.',
      );
      expect(mock.state.updates).toHaveLength(0);
    });
  });

  describe('transition — accept', () => {
    it('acepta el pedido y cancela las ofertas de los demás', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([assignmentRow()]);
      mock.queueSelect([]); // nadie lo tomó antes
      mock.queueSelect([{ id: 12n, driverId: 5n }]); // otras ofertas
      mock.queueSelect([{ authUserId: 90n }]); // cuenta del repartidor desplazado
      queueOrderDetail(orderRow({ status: 'ACCEPTED' }));

      const order = await service.transition(3, 31, 'accept');

      expect(order.status).toBe('ACCEPTED');
      expect(mock.state.transactions).toBe(1);

      const [own, cancelled] = mock.state.updates;
      expect(own.values).toMatchObject({
        status: 'ACCEPTED',
        acceptedAt: expect.any(String),
      });
      expect(cancelled.values).toMatchObject({
        status: 'CANCELLED',
        cancelledAt: expect.any(String),
        cancelReason: 'Otro repartidor aceptó el pedido',
      });

      expect(gateway.emitFleetStatus).toHaveBeenCalledWith({
        event: 'order-status',
        orderId: 31,
        driverId: 3,
        status: 'ACCEPTED',
      });
      expect(gateway.emitToDriver).toHaveBeenCalledWith(
        90,
        'delivery:order-updated',
        { orderId: 31 },
      );
      expect(ordersGateway.notifyOrderStatus).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('cancela la propia oferta si otro repartidor ya tomó el pedido', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([assignmentRow()]);
      mock.queueSelectOne({ id: 99n });

      await expect(service.transition(3, 31, 'accept')).rejects.toThrow(
        'Otro repartidor ya aceptó este pedido.',
      );

      expect(mock.state.updates).toHaveLength(1);
      expect(mock.state.updates[0].values).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Otro repartidor aceptó el pedido primero',
      });
      expect(mock.state.transactions).toBe(0);
    });
  });

  describe('transition — arrived / pickup / start', () => {
    it('marca la llegada a la tienda', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'ACCEPTED' }),
      ]);
      queueOrderDetail(orderRow({ status: 'READY_FOR_PICKUP' }));

      await service.transition(3, 31, 'arrived');

      expect(mock.state.updates[0].values).toMatchObject({
        status: 'READY_FOR_PICKUP',
        readyForPickupAt: expect.any(String),
      });
      expect(ordersGateway.notifyOrderStatus).not.toHaveBeenCalled();
    });

    it('impide recoger si ya hay otra entrega en curso', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'READY_FOR_PICKUP' }),
      ]);
      mock.queueSelectOne({ id: 12n });

      await expect(service.transition(3, 31, 'pickup')).rejects.toThrow(
        'Tienes otra entrega en curso; termínala antes de recoger este pedido.',
      );
      expect(mock.state.updates).toHaveLength(0);
    });

    it('al recoger, deja el pedido en camino y notifica al cliente', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'READY_FOR_PICKUP' }),
      ]);
      mock.queueSelect([]);
      queueOrderDetail(orderRow({ status: 'IN_DELIVERY' }));

      await service.transition(3, 31, 'pickup');

      const [assignment, order] = mock.state.updates;
      expect(assignment.values).toMatchObject({
        status: 'IN_DELIVERY',
        pickedUpAt: expect.any(String),
        inDeliveryAt: expect.any(String),
      });
      expect(order.values).toEqual({ status: 'shipped' });

      expect(gateway.emitFleetStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'order-status',
          status: 'IN_DELIVERY',
        }),
      );
      expect(ordersGateway.notifyOrderStatus).toHaveBeenCalledWith(
        'MER-1',
        'en camino',
        { customerId: 41 },
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Tu pedido está en camino 🛵',
          targetCustomerId: 41,
          linkUrl: 'order-track:MER-1',
        }),
      );
    });

    it('la acción legacy `start` también deja el pedido en camino', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'PICKED_UP' }),
      ]);
      queueOrderDetail(orderRow({ status: 'IN_DELIVERY' }));

      await service.transition(3, 31, 'start');

      const [assignment, order] = mock.state.updates;
      expect(assignment.values).toMatchObject({
        status: 'IN_DELIVERY',
        inDeliveryAt: expect.any(String),
      });
      expect(assignment.values.pickedUpAt).toBeUndefined();
      expect(order.values).toEqual({ status: 'shipped' });
    });
  });

  describe('transition — deliver / fail / reject', () => {
    it('confirma la entrega con fotos y cierra el pedido', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'IN_DELIVERY' }),
      ]);
      queueOrderDetail(
        orderRow({
          status: 'DELIVERED',
          completed_at: '2024-01-03T10:00:00.000Z',
        }),
      );

      const order = await service.transition(3, 31, 'deliver', {
        proofLocationUrl: ' https://cdn/lugar.jpg ',
        proofPackageUrl: 'https://cdn/paquete.jpg',
        note: '  dejado en portería  ',
      });

      expect(order.status).toBe('DELIVERED');

      const [assignment, shipment, orderUpdate] = mock.state.updates;
      expect(assignment.values).toMatchObject({
        status: 'DELIVERED',
        completedAt: expect.any(String),
        deliveryNote: 'dejado en portería',
      });
      expect(shipment.values).toMatchObject({ status: 'DELIVERED' });
      expect(orderUpdate.values).toEqual({ status: 'delivered' });

      expect(mock.state.inserts[0].values).toEqual([
        { assignmentId: 11, kind: 'LOCATION', url: 'https://cdn/lugar.jpg' },
        { assignmentId: 11, kind: 'PACKAGE', url: 'https://cdn/paquete.jpg' },
      ]);
      expect(ordersGateway.notifyOrderStatus).toHaveBeenCalledWith(
        'MER-1',
        'entregado',
        { customerId: 41 },
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Tu pedido fue entregado 🎉' }),
      );
    });

    it('guarda nota nula si no se envía', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'IN_DELIVERY' }),
      ]);
      queueOrderDetail(orderRow({ status: 'DELIVERED' }));

      await service.transition(3, 31, 'deliver', {
        proofLocationUrl: 'a',
        proofPackageUrl: 'b',
      });

      expect(mock.state.updates[0].values.deliveryNote).toBeNull();
    });

    it('registra una entrega fallida con su motivo', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([
        assignmentRow({ status: 'IN_DELIVERY' }),
      ]);
      queueOrderDetail(orderRow({ status: 'FAILED_DELIVERY' }));

      await service.transition(3, 31, 'fail', { reason: 'Cliente ausente' });

      expect(mock.state.updates[0].values).toMatchObject({
        status: 'FAILED_DELIVERY',
        failedAt: expect.any(String),
        rejectReason: 'Cliente ausente',
      });
      expect(ordersGateway.notifyOrderStatus).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('registra el rechazo del pedido con su motivo', async () => {
      mock.drizzle.execute.mockResolvedValueOnce([assignmentRow()]);
      queueOrderDetail(orderRow({ status: 'REJECTED' }));

      await service.transition(3, 31, 'reject', { reason: 'Lejos' });

      expect(mock.state.updates[0].values).toMatchObject({
        status: 'REJECTED',
        rejectedAt: expect.any(String),
        rejectReason: 'Lejos',
      });
    });
  });

  describe('chat del pedido', () => {
    it('devuelve los mensajes en orden cronológico', async () => {
      queueOrderDetail(orderRow({ status: 'PICKED_UP' }));
      mock.queueSelect([
        {
          id: 2n,
          senderType: 'delivery',
          body: 'segundo',
          createdAt: '2024-01-01T10:02:00.000Z',
          readAt: null,
        },
        {
          id: 1n,
          senderType: 'customer',
          body: 'primero',
          createdAt: '2024-01-01T10:01:00.000Z',
          readAt: '2024-01-01T10:05:00.000Z',
        },
      ]);

      const messages = await service.getChatMessages(3, 31);

      expect(messages.map((m) => m.body)).toEqual(['primero', 'segundo']);
      expect(messages[0]).toMatchObject({
        id: '1',
        readAt: '2024-01-01T10:05:00.000Z',
      });
    });

    it('marca como leídos los mensajes del cliente', async () => {
      queueOrderDetail(orderRow({ status: 'PICKED_UP' }));
      mock.queueUpdate([{ id: 1n }, { id: 2n }]);

      await expect(service.markChatMessagesRead(3, 31)).resolves.toEqual({
        updated: 2,
      });
      expect(mock.state.updates[0].values).toEqual({
        readAt: expect.any(String),
      });
    });

    it('envía un mensaje cuando el pedido está en camino', async () => {
      queueOrderDetail(orderRow({ status: 'PICKED_UP' }));
      mock.queueInsert([
        {
          id: 7n,
          senderType: 'delivery',
          senderUserId: 9,
          body: 'Llego en 5 minutos',
          createdAt: '2024-01-01T10:00:00.000Z',
          readAt: null,
        },
      ]);

      const message = await service.sendChatMessage(
        3,
        31,
        9,
        '  Llego en 5 minutos  ',
      );

      expect(message).toEqual({
        id: '7',
        senderType: 'delivery',
        body: 'Llego en 5 minutos',
        createdAt: '2024-01-01T10:00:00.000Z',
        readAt: null,
      });
      expect(mock.state.inserts[0].values).toMatchObject({
        orderId: 31n,
        senderType: 'delivery',
        senderUserId: 9,
        body: 'Llego en 5 minutos',
      });
    });

    it('rechaza un mensaje vacío', async () => {
      queueOrderDetail(orderRow({ status: 'PICKED_UP' }));

      await expect(
        service.sendChatMessage(3, 31, 9, '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mock.state.inserts).toHaveLength(0);
    });

    it('rechaza un mensaje de más de 2000 caracteres', async () => {
      queueOrderDetail(orderRow({ status: 'IN_DELIVERY' }));

      await expect(
        service.sendChatMessage(3, 31, 9, 'x'.repeat(2001)),
      ).rejects.toThrow('El mensaje no puede superar 2000 caracteres.');
    });

    it('solo permite escribir mientras el pedido está en camino', async () => {
      queueOrderDetail(orderRow({ status: 'ACCEPTED' }));

      await expect(
        service.sendChatMessage(3, 31, 9, 'hola'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mock.state.inserts).toHaveLength(0);
    });
  });

  describe('disponibilidad y push token', () => {
    it('actualiza la disponibilidad y avisa a la flota', async () => {
      await expect(service.setAvailability(3, true)).resolves.toEqual({
        ok: true,
      });

      expect(mock.state.updates[0].values).toEqual({
        isAvailable: true,
        lastSeenAt: expect.any(String),
      });
      expect(gateway.emitFleetStatus).toHaveBeenCalledWith({
        event: 'availability',
        driverId: 3,
        isAvailable: true,
      });
    });

    it('guarda el token push del repartidor', async () => {
      await expect(service.setPushToken(3, 'token-1')).resolves.toEqual({
        ok: true,
      });

      expect(mock.state.updates[0].values).toEqual({ pushToken: 'token-1' });
    });
  });
});
