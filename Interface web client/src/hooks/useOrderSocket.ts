import { io, Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';
import { ordersService } from '../services/orders.service';

const SOCKET_URL = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3000'));

export function useOrderSocket(orderId: string | null) {
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [orderReason, setOrderReason] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!orderId) return;

    const socket = io(`${SOCKET_URL}/orders`, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe:order', orderId);
    });

    socket.on('order:status', (data: { orderId: string; status: string; reason?: string }) => {
      setOrderStatus(data.status);
      if (data.reason) setOrderReason(data.reason);
    });

    // Fallback: si el evento del socket no llega (o el pago tarda), consulta
    // el estado REAL del pedido por API hasta que sea definitivo.
    let stopped = false;
    let attempts = 0;
    const poll = async () => {
      if (stopped || attempts >= 15) return; // máx ~60s
      attempts++;
      try {
        const tracked = await ordersService.trackOrder(orderId);
        const s = tracked?.status;
        // "pendiente" = payment_pending: seguir esperando.
        // "confirmado" (paid) se normaliza a "preparando" para la UI.
        if (s && s !== 'pendiente') {
          setOrderStatus(s === 'confirmado' ? 'preparando' : s);
          return;
        }
      } catch {
        /* reintentar */
      }
      setTimeout(poll, 4000);
    };
    const pollTimer = setTimeout(poll, 4000);

    return () => {
      stopped = true;
      clearTimeout(pollTimer);
      socket.emit('unsubscribe:order', orderId);
      socket.disconnect();
    };
  }, [orderId]);

  return { status: orderStatus, reason: orderReason };
}
