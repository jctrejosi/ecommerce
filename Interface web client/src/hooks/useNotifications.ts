import { io, Socket } from 'socket.io-client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { getAuthHeaders } from '../services/customer-auth.service';
import { playAlertSound, unlockAlertSound } from '../app/lib/alertSound';
import {
  requestNotificationPermission,
  showBrowserNotification,
  canShowNotifications,
} from '../app/lib/browserNotifications';

const SOCKET_URL = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3000'));

/** ¿El dispositivo es un teléfono? Decide quién responde con su ubicación. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
}

/** Lee el GPS del dispositivo. Devuelve null si no hay permiso o falla. */
function readDeviceCoords(
  timeout = 10000,
): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  linkUrl?: string;
  createdAt: string;
}

export function useNotifications(customerId: number | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  // Peticiones de ubicación en curso, por `requestId` (PC esperando al teléfono).
  const pendingLocationRef = useRef<
    Map<string, (coords: { lat: number; lng: number } | null) => void>
  >(new Map());

  // Connect to socket
  useEffect(() => {
    if (!customerId) return;

    const socket = io(`${SOCKET_URL}/notifications`, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe:customer', customerId);
    });

    socket.on('notification:new', (notification: AppNotification) => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
      // Aviso inmediato: alerta sonora y, si el navegador ya dio permiso,
      // también la notificación del sistema.
      playAlertSound();
      showBrowserNotification(notification.title, notification.message);
    });

    // El teléfono responde a la petición de ubicación que hace el PC.
    socket.on('location:request', async (payload: { requestId: string }) => {
      if (!isMobileDevice() || !payload?.requestId) return;
      const respond = async () => {
        const coords = await readDeviceCoords();
        if (coords) {
          socket.emit('location:response', {
            customerId,
            requestId: payload.requestId,
            ...coords,
          });
        }
      };
      if (canShowNotifications()) {
        showBrowserNotification(
          'Mercaldas',
          'Toca para compartir tu ubicación y confirmar tu pedido.',
          () => void respond(),
        );
      } else {
        // WebView sin notificaciones del sistema: se responde directamente.
        await respond();
      }
    });

    // El PC recibe la ubicación que envió el teléfono.
    socket.on(
      'location:response',
      (payload: { requestId: string; lat: number; lng: number }) => {
        const resolve = pendingLocationRef.current.get(payload?.requestId);
        if (!resolve) return;
        pendingLocationRef.current.delete(payload.requestId);
        resolve({ lat: payload.lat, lng: payload.lng });
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [customerId]);

  // El navegador exige un gesto del usuario antes de dejar sonar audio y antes
  // de poder pedir el permiso de notificaciones: se aprovecha la primera
  // interacción (solo para clientes con sesión, que son los que las reciben).
  useEffect(() => {
    if (!customerId) return;
    const onFirstInteraction = () => {
      unlockAlertSound();
      requestNotificationPermission();
    };
    window.addEventListener("pointerdown", onFirstInteraction, { once: true });
    return () =>
      window.removeEventListener("pointerdown", onFirstInteraction);
  }, [customerId]);

  // Puente para la APK: el cascarón nativo (Expo) obtiene el token FCM del
  // dispositivo y lo entrega aquí; como esta página sí tiene la sesión del
  // cliente, es la que registra el token en el backend.
  useEffect(() => {
    if (!customerId) return;
    const API =
      import.meta.env.VITE_API_URL ||
      (typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:3000');
    const bridge = window as unknown as {
      __mercaldasSetPushToken?: (token: string) => void;
    };
    bridge.__mercaldasSetPushToken = (token: string) => {
      if (!token) return;
      void fetch(`${API}/customer-auth/push-token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    };
    // Si el cascarón nativo ya dejó el token antes de que hubiera sesión, se
    // registra ahora que el cliente está autenticado.
    const pendingToken = (
      window as unknown as { __mercaldasPushToken?: string }
    ).__mercaldasPushToken;
    if (pendingToken) bridge.__mercaldasSetPushToken(pendingToken);

    // Y le pedimos el token al cascarón nativo (app): así no dependemos del
    // orden en que se cargue la página o se inicie sesión.
    try {
      (
        window as unknown as {
          ReactNativeWebView?: { postMessage: (m: string) => void };
        }
      ).ReactNativeWebView?.postMessage(
        JSON.stringify({ type: 'request-push-token' }),
      );
    } catch {
      /* no estamos dentro de la app */
    }
    return () => {
      delete bridge.__mercaldasSetPushToken;
    };
  }, [customerId]);

  // Load existing notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const API = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3000'));
      const res = await fetch(`${API}/notifications`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadCount(data.filter((n: AppNotification) => !n.isRead).length);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (customerId) fetchNotifications();
  }, [customerId, fetchNotifications]);

  const markAsRead = useCallback(async (id: number) => {
    const API = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3000'));
    await fetch(`${API}/notifications/${id}/read`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
    });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  /**
   * Pide la ubicación al teléfono del cliente (para PCs, donde el GPS del
   * navegador no es fiable). Devuelve las coordenadas o `null` si no llegan.
   */
  const requestPhoneLocation = useCallback(
    (timeoutMs = 90000): Promise<{ lat: number; lng: number } | null> => {
      const socket = socketRef.current;
      if (!socket || !customerId) return Promise.resolve(null);
      const requestId =
        typeof crypto !== "undefined" && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve) => {
        pendingLocationRef.current.set(requestId, resolve);
        socket.emit('location:request', { customerId, requestId });
        window.setTimeout(() => {
          if (pendingLocationRef.current.has(requestId)) {
            pendingLocationRef.current.delete(requestId);
            resolve(null);
          }
        }, timeoutMs);
      });
    },
    [customerId],
  );

  return { notifications, unreadCount, markAsRead, requestPhoneLocation };
}
