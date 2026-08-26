import { io, Socket } from "socket.io-client";
import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Monitorea la disponibilidad del backend.
 *
 * Doble vía (híbrida):
 *  1. WebSocket (namespace `/status`): el servidor emite `backend:online`
 *     al conectarse/reconectarse → señal instantánea.
 *  2. Polling HTTP a `/api-status` cada 5s: respaldo garantizado, porque
 *     socket.io tarda ~25-45s en detectar una caída (ping cada 25s) y sin
 *     esto el aviso de "el backend volvió" llegaría demasiado tarde.
 *
 * `online` puede ser:
 *  - `null`: todavía sin información (primera comprobación en curso)
 *  - `true`:  backend disponible
 *  - `false`: backend caído (tras 5s continuos de fallo, para evitar
 *             falsos positivos por microcortes de red)
 */
export function useBackendStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  const failureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // ── WebSocket (aviso instantáneo) ────────────────────────────
    const socket: Socket = io(`${API_URL}/status`, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    // Debounce de 5s: se marca "caído" solo si el fallo persiste 5s seguidos.
    // El temporizador NO se reinicia con fallos repetidos (poll/connect_error),
    // solo se cancela con un éxito.
    const markOffline = () => {
      if (failureTimer.current) return;
      failureTimer.current = setTimeout(() => {
        if (!cancelled) setOnline(false);
      }, 5000);
    };
    const markOnline = () => {
      if (failureTimer.current) {
        clearTimeout(failureTimer.current);
        failureTimer.current = null;
      }
      if (!cancelled) setOnline(true);
    };

    socket.on("connect", markOnline);
    socket.on("backend:online", markOnline);
    socket.on("disconnect", markOffline);
    socket.on("connect_error", markOffline);

    // ── Polling HTTP (detección garantizada) ─────────────────────
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api-status`, {
          credentials: "include",
          cache: "no-store",
        });
        if (res.ok) markOnline();
        else markOffline();
      } catch {
        markOffline();
      }
    };
    void check();
    const interval = setInterval(check, 5000);

    return () => {
      cancelled = true;
      if (failureTimer.current) clearTimeout(failureTimer.current);
      clearInterval(interval);
      socket.disconnect();
    };
  }, []);

  return { online };
}
