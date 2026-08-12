import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * Gateway de estado del backend (namespace `/status`).
 *
 * El web client y el admin se conectan aquí y reciben el evento
 * `backend:online` en dos situaciones:
 *  - al conectarse (socket.io reconecta automáticamente cuando el backend
 *    vuelve a estar disponible tras una caída), y
 *  - cuando la base de datos se confirma disponible con el proceso vivo
 *    (broadcast a todos los clientes conectados).
 *
 * Con eso el front puede mostrar el aviso "Servidor disponible" y
 * recargar el sitio para cargar datos frescos.
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/status',
})
export class StatusGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(StatusGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Status client connected: ${client.id}`);
    // Al conectarse el backend está disponible: aviso inmediato.
    client.emit('backend:online', { timestamp: new Date().toISOString() });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Status client disconnected: ${client.id}`);
  }

  /** Emite `backend:online` a todos los clientes conectados (p. ej. tras restaurarse la BD). */
  notifyBackendOnline() {
    if (!this.server) return;
    this.server.emit('backend:online', { timestamp: new Date().toISOString() });
  }
}
