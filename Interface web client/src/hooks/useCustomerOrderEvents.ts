import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

export interface CustomerOrderEvent {
  referenceCode: string;
  /** Estado normalizado para la UI: preparando | listo | en camino | entregado | cancelado. */
  status: string;
  reason: string | null;
  at: string;
}

/**
 * Cambios de estado de TODOS los pedidos del cliente (namespace `/orders`,
 * sala `customer:<id>`).
 *
 * A diferencia de `useOrderSocket` (que sigue un único pedido durante el
 * checkout), este hook mantiene al día la lista "Mis pedidos": llegan los
 * cambios hechos por el picking ("preparando", "listo") y por el repartidor
 * ("en camino", "entregado").
 */
export function useCustomerOrderEvents(
  customerId: number | null,
  onEvent: (event: CustomerOrderEvent) => void,
) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!customerId) return;

    const socket = io(`${SOCKET_URL}/orders`, {
      transports: ['websocket', 'polling'],
    });

    const subscribe = () => socket.emit('subscribe:customer', customerId);
    socket.on('connect', subscribe);
    socket.on('order:updated', (payload: CustomerOrderEvent) => {
      handler.current(payload);
    });

    return () => {
      socket.emit('unsubscribe:customer', customerId);
      socket.off('connect', subscribe);
      socket.disconnect();
    };
  }, [customerId]);
}
