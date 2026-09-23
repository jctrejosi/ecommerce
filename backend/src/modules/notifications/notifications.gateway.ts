import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:customer')
  handleSubscribe(client: Socket, customerId: number) {
    const room = `customer:${customerId}`;
    void client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ${room}`);
  }

  notifyCustomer(customerId: number, notification: any) {
    const room = `customer:${customerId}`;
    this.server.to(room).emit('notification:new', notification);
    this.logger.log(`Notification sent to ${room}: ${notification.title}`);
  }

  /**
   * El PC pide la ubicación del teléfono. Se reenvía a los DEMÁS dispositivos
   * del mismo cliente (el emisor no lo recibe), que la responderán capturando
   * el GPS del teléfono.
   */
  @SubscribeMessage('location:request')
  handleLocationRequest(
    client: Socket,
    payload: { customerId: number; requestId: string },
  ) {
    const room = `customer:${Number(payload?.customerId)}`;
    client.to(room).emit('location:request', { requestId: payload?.requestId });
    this.logger.log(`Location request ${payload?.requestId} → ${room}`);
  }

  /**
   * El teléfono devuelve las coordenadas. Se reenvían a los DEMÁS dispositivos
   * del cliente (el que responde no las recibe), que las aplicarán.
   */
  @SubscribeMessage('location:response')
  handleLocationResponse(
    client: Socket,
    payload: { customerId: number; requestId: string; lat: number; lng: number },
  ) {
    const room = `customer:${Number(payload?.customerId)}`;
    client.to(room).emit('location:response', {
      requestId: payload?.requestId,
      lat: payload?.lat,
      lng: payload?.lng,
    });
    this.logger.log(`Location response ${payload?.requestId} → ${room}`);
  }
}
