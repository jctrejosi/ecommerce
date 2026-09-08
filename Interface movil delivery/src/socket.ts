import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { API_URL, USE_MOCK } from "@/api/client";
import { queryClient } from "@/lib/queryClient";
import { orderKeys } from "@/api/orders";

let socket: Socket | null = null;

/**
 * Conecta al namespace /delivery y sincroniza la cache con los eventos del
 * backend. En modo mock no se conecta.
 */
export function connectDeliverySocket(accessToken: string): void {
  if (USE_MOCK || !API_URL) return;
  if (socket) return;

  socket = io(`${API_URL}/delivery`, {
    transports: ["websocket"],
    auth: { token: accessToken },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  socket.on("connect", () => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
  });

  socket.on("delivery:assigned", () => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
  });

  socket.on("delivery:order-updated", ({ orderId }: { orderId: number | string }) => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
  });

  socket.on("delivery:cancelled", ({ orderId }: { orderId: number | string }) => {
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    void queryClient.invalidateQueries({ queryKey: orderKeys.active });
  });
}

export function disconnectDeliverySocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
