import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/** Sala de los paneles administrativos (web admin, picking admin, delivery admin). */
export const STAFF_ROOM = 'staff';

/** Sala del cliente dueño (todos sus pedidos). */
export function customerRoom(customerId: number): string {
  return `customer:${customerId}`;
}

export interface OrderStatusOptions {
  /** Motivo visible (p. ej. por qué se canceló el pedido). */
  reason?: string | null;
  /** Cliente dueño del pedido: si se pasa, se le avisa por su sala. */
  customerId?: number | null;
}

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/orders',
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OrdersGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:order')
  handleSubscribeOrder(client: Socket, orderId: string) {
    const room = `order:${orderId}`;
    void client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ${room}`);
  }

  @SubscribeMessage('unsubscribe:order')
  handleUnsubscribeOrder(client: Socket, orderId: string) {
    const room = `order:${orderId}`;
    void client.leave(room);
    this.logger.log(`Client ${client.id} unsubscribed from ${room}`);
  }

  /** Los paneles administrativos se unen a la sala `staff` para ver todo. */
  @SubscribeMessage('subscribe:staff')
  handleSubscribeStaff(client: Socket) {
    void client.join(STAFF_ROOM);
    this.logger.log(`Client ${client.id} subscribed to ${STAFF_ROOM}`);
  }

  @SubscribeMessage('unsubscribe:staff')
  handleUnsubscribeStaff(client: Socket) {
    void client.leave(STAFF_ROOM);
    this.logger.log(`Client ${client.id} unsubscribed from ${STAFF_ROOM}`);
  }

  /**
   * El cliente se une a la sala de TODOS sus pedidos. Así "Mis pedidos" se
   * actualiza en vivo sin depender de tener abierto el del checkout.
   */
  @SubscribeMessage('subscribe:customer')
  handleSubscribeCustomer(client: Socket, customerId: number | string) {
    const id = Number(customerId);
    if (!Number.isFinite(id)) return;
    const room = customerRoom(id);
    void client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ${room}`);
  }

  @SubscribeMessage('unsubscribe:customer')
  handleUnsubscribeCustomer(client: Socket, customerId: number | string) {
    const id = Number(customerId);
    if (!Number.isFinite(id)) return;
    void client.leave(customerRoom(id));
  }

  /**
   * Cambio de estado de un pedido. Es el punto único de difusión:
   *  - al cliente dueño en la sala del pedido (`order:<referenceCode>`), que ya
   *    consume `order:status` con el estado normalizado en español,
   *  - al cliente dueño en su sala (`customer:<id>`), para refrescar su lista,
   *  - a los paneles administrativos (sala `staff`).
   *
   * Todos los que llaman a este método (pago, picking, admin, delivery) avisan
   * así a todos los públicos sin duplicar lógica.
   */
  notifyOrderStatus(
    referenceCode: string,
    status: string,
    opts: OrderStatusOptions = {},
  ) {
    const { reason = null, customerId = null } = opts;
    const room = `order:${referenceCode}`;

    if (!this.server) {
      this.logger.warn(`Gateway sin servidor listo; se ignora ${room}: ${status}`);
      return;
    }

    // Contrato clásico (lo consume el seguimiento del checkout).
    this.server.to(room).emit('order:status', {
      orderId: referenceCode,
      status,
      reason,
    });

    // Evento enriquecido: mismo cambio para el pedido, el cliente y los paneles.
    const updated = { referenceCode, status, reason, at: new Date().toISOString() };
    this.server.to(room).emit('order:updated', updated);
    if (customerId != null) {
      this.server.to(customerRoom(Number(customerId))).emit('order:updated', updated);
    }
    this.server.to(STAFF_ROOM).emit('order:updated', updated);

    this.logger.log(
      `Status update sent to ${room}${customerId != null ? ` + ${customerRoom(Number(customerId))}` : ''} + ${STAFF_ROOM}: ${status}${reason ? ` (${reason})` : ''}`,
    );
  }
}
