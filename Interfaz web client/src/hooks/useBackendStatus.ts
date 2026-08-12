import { io, Socket } from "socket.io-client";
import { useEffect, useRef, useState } from "react";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Monitorea la disponibilidad del backend vía WebSocket (namespace `/status`).
 *
 * A diferencia del polling HTTP, socket.io reconecta automáticamente cuando
 * el backend vuelve a estar disponible y el servidor emite `backend:online`,
 * así que el front sabe exactamente cuándo recargar el sitio.
 *
 * `online` puede ser:
 *  - `null`: todavía sin información (conectando)
 *  - `true`:  backend disponible
 *  - `false`: backend caído (tras un margen de tolerancia para evitar
 *             falsos positivos por microcortes de red)
 */
export function useBackendStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  const failureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_URL}/status`, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    // Margen de tolerancia: solo se marca como caído si el fallo persiste
    // más de 5s (evita recargas por microcortes de red).
    const markOffline = () => {
      if (failureTimer.current) clearTimeout(failureTimer.current);
      failureTimer.current = setTimeout(() => setOnline(false), 5000);
    };

    const markOnline = () => {
      if (failureTimer.current) {
        clearTimeout(failureTimer.current);
        failureTimer.current = null;
      }
      setOnline(true);
    };

    socket.on("connect", markOnline);
    socket.on("backend:online", markOnline);
    socket.on("disconnect", markOffline);
    socket.on("connect_error", markOffline);

    return () => {
      if (failureTimer.current) clearTimeout(failureTimer.current);
      socket.disconnect();
    };
  }, []);

  return { online };
}
