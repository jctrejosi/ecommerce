import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type { AdminChatMessage } from "./types";

export const adminChatKeys = {
  messages: ["delivery", "admin-chat", "messages"] as const,
  summary: ["delivery", "admin-chat", "summary"] as const,
};

/**
 * Hilo del repartidor con el panel (administración).
 *
 * El socket avisa al instante cuando llega un mensaje; el intervalo de 3 s
 * queda como respaldo por si la conexión en vivo no está disponible.
 */
export function useAdminChatMessages() {
  return useQuery({
    queryKey: adminChatKeys.messages,
    queryFn: () => api.getAdminChatMessages(),
    refetchInterval: 3_000,
  });
}

/** No leídos + último mensaje (badge del header). */
export function useAdminChatSummary() {
  return useQuery({
    queryKey: adminChatKeys.summary,
    queryFn: () => api.getAdminChatSummary(),
    refetchInterval: 15_000,
  });
}

/** Envía un mensaje al panel y lo agrega a la caché. */
export function useSendAdminChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string) => api.sendAdminChatMessage(body),
    onSuccess: (msg) => {
      queryClient.setQueryData<AdminChatMessage[]>(adminChatKeys.messages, (prev) =>
        prev ? [...prev, msg] : [msg],
      );
      void queryClient.invalidateQueries({ queryKey: adminChatKeys.summary });
    },
  });
}
