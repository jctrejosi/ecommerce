import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { pickingApi } from "@/api";
import type { PickerChatMessage } from "@/api";

export const pickerChatKeys = {
  messages: ["picking", "chat", "messages"] as const,
  summary: ["picking", "chat", "summary"] as const,
};

/**
 * Hilo único del picker con administración.
 *
 * El socket avisa al instante cuando llega un mensaje; el intervalo de 3 s queda
 * como respaldo por si la conexión en vivo no está disponible.
 */
export function usePickerChatMessages() {
  return useQuery({
    queryKey: pickerChatKeys.messages,
    queryFn: () => pickingApi.chatMessages(),
    refetchInterval: 3_000,
  });
}

/** No leídos + último mensaje (badge del header). */
export function usePickerChatSummary() {
  return useQuery({
    queryKey: pickerChatKeys.summary,
    queryFn: () => pickingApi.chatSummary(),
    refetchInterval: 15_000,
  });
}

/** Envía un mensaje a administración y lo agrega a la caché. */
export function useSendPickerChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string) => pickingApi.sendChatMessage(body),
    onSuccess: (msg) => {
      queryClient.setQueryData<PickerChatMessage[]>(pickerChatKeys.messages, (prev) =>
        prev ? [...prev, msg] : [msg],
      );
      void queryClient.invalidateQueries({ queryKey: pickerChatKeys.summary });
    },
  });
}
