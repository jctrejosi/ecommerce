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

/** Mensaje del chat repartidor ↔ admin emitido a la sala `fleet`. */
export interface FleetChatEvent {
  driverId: number;
  message: {
    id: number;
    senderType: 'driver' | 'admin';
    body: string;
    createdAt: string | null;
  };
  at?: string;
}

export interface FleetSocketHandlers {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onLocation?: (p: FleetLocationEvent) => void;
  onStatus?: (p: FleetStatusEvent) => void;
  onChat?: (p: FleetChatEvent) => void;
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
  socket.on('delivery:admin-chat', (p: FleetChatEvent) => handlers.onChat?.(p));

  return () => {
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
  };
}

export interface OrderUpdatedEvent {
  referenceCode: string;
  status: string;
  reason: string | null;
  at: string;
}

export interface OrdersSocketHandlers {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onOrderUpdated?: (p: OrderUpdatedEvent) => void;
}

let ordersSocket: Socket | null = null;

/**
 * Cambios de estado de pedidos (namespace `/orders`, sala `staff`).
 *
 * El `/delivery` solo avisa de lo que hace la flota; los cambios de pago,
 * picking o del propio panel viajan por aquí. Con esto la lista de pedidos del
 * delivery admin se entera de **cualquier** transición, venga de donde venga.
 */
export function connectOrdersSocket(handlers: OrdersSocketHandlers): () => void {
  if (ordersSocket) return () => {};

  ordersSocket = io(`${API_BASE_URL}/orders`, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  const subscribe = () => ordersSocket?.emit('subscribe:staff');
  ordersSocket.on('connect', () => {
    subscribe();
    handlers.onConnect?.();
  });
  ordersSocket.on('disconnect', () => handlers.onDisconnect?.());
  ordersSocket.on('order:updated', (p: OrderUpdatedEvent) =>
    handlers.onOrderUpdated?.(p),
  );

  return () => {
    ordersSocket?.emit('unsubscribe:staff');
    ordersSocket?.removeAllListeners();
    ordersSocket?.disconnect();
    ordersSocket = null;
  };
}
