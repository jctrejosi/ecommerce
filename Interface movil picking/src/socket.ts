import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { getApiUrl } from "@/api/apiConfig";
import { queryClient } from "@/lib/queryClient";
import { pickerChatKeys } from "@/api/picker-chat";
import { PICKING_ROOT } from "@/picking/queries";

let socket: Socket | null = null;

/**
 * Escucha el namespace `/picking-events` y refresca la cola cuando otro picker
 * escanea, reclama o entrega un pedido.
 *
 * Va autenticado con el token del picker: es lo que le permite entrar a su sala
 * (y así recibir los mensajes de su hilo de chat). Sin token no se conecta.
 */
export function connectPickingSocket(accessToken: string): void {
  if (socket) return;
  if (!accessToken) return;

  socket = io(`${getApiUrl()}/picking-events`, {
    transports: ["websocket"],
    auth: { token: accessToken },
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

  // Mensaje de administración: refresca el hilo y el badge, esté donde esté el
  // picker dentro de la app.
  socket.on("picking:chat", () => {
    void queryClient.invalidateQueries({ queryKey: pickerChatKeys.messages });
    void queryClient.invalidateQueries({ queryKey: pickerChatKeys.summary });
  });
}

export function disconnectPickingSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
