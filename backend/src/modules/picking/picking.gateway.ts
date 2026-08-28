import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * Gateway de eventos de picking (namespace `/picking-events`).
 *
 * Emite en vivo cada acción del picker para que el admin de picking
 * (Métricas) se actualice al instante:
 *   - `picking:claim`     { orderId, referenceCode, pickerId }
 *   - `picking:scan`      { orderId, referenceCode, pickerId, scannedPieces, totalPieces }
 *   - `picking:delivered` { orderId, referenceCode, pickerId, deliveredAt }
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/picking-events',
})
export class PickingGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PickingGateway.name);

  emit(event: string, payload: Record<string, unknown>) {
    if (!this.server) return;
    this.server.emit(event, payload);
  }
}
