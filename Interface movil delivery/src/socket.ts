import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { USE_MOCK } from "@/api/client";
import { getServerUrl } from "@/api/server";
import { queryClient } from "@/lib/queryClient";
import { orderKeys } from "@/api/orders";
import { adminChatKeys } from "@/api/admin-chat";
import { playIncomingMessageSound } from "@/notifications/sound";
import { alertNewOrder } from "@/notifications/newOrderAlert";

let socket: Socket | null = null;

/**
 * Conecta al namespace /delivery y sincroniza la cache con los eventos del
 * backend. En modo mock no se conecta.
 */
export function connectDeliverySocket(accessToken: string): void {
  const baseUrl = getServerUrl();
  if (USE_MOCK || !baseUrl) return;
  if (socket) return;

  socket = io(`${baseUrl}/delivery`, {
    transports: ["websocket"],
    auth: { token: accessToken },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  socket.on("connect", () => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
  });

  socket.on("delivery:assigned", ({ orderId, referenceCode }: { orderId: number | string; referenceCode?: string }) => {
    // Pedido nuevo: suena, vibra y deja el aviso en la bandeja (punto rojo).
    void alertNewOrder({ id: orderId, referenceCode: referenceCode ?? String(orderId) });
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
  });

  socket.on("delivery:order-updated", ({ orderId }: { orderId: number | string }) => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
    void queryClient.invalidateQueries({ queryKey: orderKeys.history });
  });

  socket.on("delivery:admin-chat", () => {
    // Mensaje del panel: suena el tono y se refresca el hilo y el badge.
    playIncomingMessageSound();
    void queryClient.invalidateQueries({ queryKey: adminChatKeys.messages });
    void queryClient.invalidateQueries({ queryKey: adminChatKeys.summary });
  });

  socket.on("delivery:cancelled", ({ orderId }: { orderId: number | string }) => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
    void queryClient.invalidateQueries({ queryKey: orderKeys.history });
  });
}

export function disconnectDeliverySocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
