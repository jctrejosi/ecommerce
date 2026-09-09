import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL, getToken } from './api';

export interface FleetLocationEvent {
  driverId: number;
  lat: number;
  lng: number;
  at?: string | null;
}

export interface FleetStatusEvent {
  event: 'order-status' | 'availability' | string;
  driverId?: number;
  orderId?: number;
  [key: string]: unknown;
}

export interface FleetSocketHandlers {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onLocation?: (p: FleetLocationEvent) => void;
  onStatus?: (p: FleetStatusEvent) => void;
}

let socket: Socket | null = null;

/**
 * Conecta al namespace `/delivery` con el token de administrador.
 * El backend une a los admins (isSuperuser) a la sala `fleet`, desde la que
 * emite `delivery:fleet-location` (ping GPS) y `delivery:fleet-status`
 * (cambios de pedido/disponibilidad).
 */
export function connectFleetSocket(handlers: FleetSocketHandlers): () => void {
  const token = getToken();
  if (!token || socket) return () => {};

  socket = io(`${API_BASE_URL}/delivery`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  socket.on('connect', () => handlers.onConnect?.());
  socket.on('disconnect', () => handlers.onDisconnect?.());
  socket.on('delivery:fleet-location', (p: FleetLocationEvent) =>
    handlers.onLocation?.(p),
  );
  socket.on('delivery:fleet-status', (p: FleetStatusEvent) =>
    handlers.onStatus?.(p),
  );

  return () => {
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
  };
}
