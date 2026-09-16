import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Gateway de eventos de picking (namespace `/picking-events`).
 *
 * Emite en vivo cada acción del picker para que el admin de picking
 * (Métricas) se actualice al instante:
 *   - `picking:claim`     { orderId, referenceCode, pickerId }
 *   - `picking:scan`      { orderId, referenceCode, pickerId, scannedPieces, totalPieces }
 *   - `picking:delivered` { orderId, referenceCode, pickerId, deliveredAt }
 *
 * También transporta el chat picker ↔ administrador (`picking:chat`). Para eso
 * usa salas: el móvil entra a `picker:<userId>` (mandando su token en
 * `auth.token`) y el panel a `staff` (`subscribe:staff`). El token es opcional:
 * quien no lo mande sigue recibiendo los avisos generales de arriba.
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/picking-events',
})
export class PickingGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PickingGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) return;
    try {
      const secret =
        this.configService.get<string>('jwt.secret') ?? 'secret-key';
      const payload = this.jwtService.verify<{ sub: number | string }>(token, {
        secret,
      });
      void client.join(`picker:${Number(payload.sub)}`);
    } catch {
      this.logger.warn(
        `Conexión /picking-events con token inválido (${client.id})`,
      );
    }
  }

  /** El panel de picking se une a la sala de staff para ver todo el chat. */
  @SubscribeMessage('subscribe:staff')
  onSubscribeStaff(@ConnectedSocket() client: Socket) {
    void client.join('staff');
  }

  @SubscribeMessage('unsubscribe:staff')
  onUnsubscribeStaff(@ConnectedSocket() client: Socket) {
    void client.leave('staff');
  }

  emit(event: string, payload: Record<string, unknown>) {
    if (!this.server) return;
    this.server.emit(event, payload);
  }

  /** Emite a la sala de un picker concreto (`picker:<userId>`). */
  emitToPicker(
    userId: number,
    event: string,
    payload: Record<string, unknown>,
  ) {
    this.server?.to(`picker:${userId}`).emit(event, payload);
  }

  /** Emite al panel de picking (sala `staff`). */
  emitStaff(event: string, payload: Record<string, unknown>) {
    this.server?.to('staff').emit(event, payload);
  }
}
