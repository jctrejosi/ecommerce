import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Gateway de delivery (namespace `/delivery`).
 *
 * El repartidor conecta con `auth.token`; se valida y se une a la sala
 * `driver:<userId>` para recibir eventos en vivo (asignaciones, cambios de
 * pedido, cancelaciones). También hay una sala `fleet` para que el panel
 * administrativo vea la posición de toda la flota.
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/delivery',
})
export class DeliveryGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DeliveryGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('sin token');
      const secret =
        this.configService.get<string>('jwt.secret') ?? 'secret-key';
      const payload = this.jwtService.verify<{
        sub: number | string;
        isSuperuser?: boolean;
      }>(token, { secret });
      const userId = Number(payload.sub);
      const data = client.data as { userId?: number; isSuperuser?: boolean };
      data.userId = userId;
      data.isSuperuser = Boolean(payload.isSuperuser);
      if (payload.isSuperuser) {
        // Administrador (panel web): se une a la sala de flota.
        void client.join('fleet');
        this.logger.log(`Admin conectado a /delivery (fleet): user ${userId}`);
      } else {
        void client.join(`driver:${userId}`);
        this.logger.log(`Repartidor conectado: user ${userId}`);
      }
    } catch {
      this.logger.warn(
        `Conexión /delivery rechazada (${client.id}): token inválido`,
      );
      client.disconnect(true);
    }
  }

  emitDriverLocation(driverId: number, payload: Record<string, unknown>) {
    this.server?.to('fleet').emit('delivery:fleet-location', {
      driverId,
      ...payload,
      at: new Date().toISOString(),
    });
  }

  /** Emite un evento a la sala de un repartidor concreto (`driver:<userId>`). */
  emitToDriver(
    userId: number,
    event: string,
    payload: Record<string, unknown>,
  ) {
    this.server?.to(`driver:${userId}`).emit(event, payload);
  }

  /** Cambios de estado de pedidos/disponibilidad para el panel administrativo. */
  emitFleetStatus(payload: Record<string, unknown>) {
    this.server?.to('fleet').emit('delivery:fleet-status', {
      ...payload,
      at: new Date().toISOString(),
    });
  }

  /**
   * Mensaje del chat repartidor ↔ admin para el panel (sala `fleet`).
   * Se emite en ambos sentidos: el admin ve llegar los del repartidor y también
   * se sincronizan entre administradores con el panel abierto.
   */
  emitFleetChat(payload: Record<string, unknown>) {
    this.server?.to('fleet').emit('delivery:admin-chat', {
      ...payload,
      at: new Date().toISOString(),
    });
  }
}
