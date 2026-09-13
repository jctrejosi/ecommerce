import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { API_URL } from "@/api";
import { queryClient } from "@/lib/queryClient";
import { PICKING_ROOT } from "@/picking/queries";

let socket: Socket | null = null;

/**
 * Escucha el namespace `/picking-events` (sin autenticación) y refresca la
 * cola cuando otro picker escanea, reclama o entrega un pedido.
 */
export function connectPickingSocket(): void {
  if (socket || !API_URL) return;

  socket = io(`${API_URL}/picking-events`, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: PICKING_ROOT });
  };

  socket.on("connect", refresh);
  socket.on("picking:claim", refresh);
  socket.on("picking:scan", refresh);
  socket.on("picking:delivered", refresh);
}

export function disconnectPickingSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
