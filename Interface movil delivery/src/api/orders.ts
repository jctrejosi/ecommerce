import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type { TransitionKey, TransitionPayload } from "./contract";

const ACTIVE_KEY = ["delivery", "orders", "active"] as const;
const HISTORY_KEY = ["delivery", "orders", "history"] as const;

export const orderKeys = {
  active: ACTIVE_KEY,
  history: HISTORY_KEY,
  detail: (id: number | string) => ["delivery", "orders", "detail", id] as const,
};

/** Pedidos activos (asignados al repartidor). Refresca cada 5 s. */
export function useActiveOrders() {
  return useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: () => api.getActiveOrders(),
    refetchInterval: 5_000,
  });
}

export function useOrder(id: number | string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(id ?? ""),
    queryFn: () => api.getOrder(id!),
    enabled: id !== undefined,
  });
}

export function useHistory() {
  return useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => api.getHistory(),
  });
}

/** Ruta recomendada (OSRM) para un pedido. Recálculo cada 60 s.
 *  `from` es opcional: sin él, el backend usa la última posición conocida.
 *  `target` indica hacia dónde se pide la ruta: la tienda a recoger ('store')
 *  o el cliente ('customer'); undefined ⇒ no se consulta ruta. */
export function useOrderRoute(
  orderId: number | string | undefined,
  from: string | undefined,
  target: "customer" | "store" | undefined,
) {
  return useQuery({
    queryKey: ["delivery", "orders", "route", orderId ?? "", from ?? "", target ?? ""] as const,
    queryFn: () => api.getRoute(orderId!, from, target),
    enabled: orderId !== undefined && target !== undefined,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 15_000,
  });
}

/**
 * Ejecuta una transición de estado contra el backend. Al éxito, actualiza la
 * cache (pedido + listas). El `expectedStatus` se maneja server-side; aquí el
 * 409 simplemente refetchea el detalle.
 */
export function useTransitionOrder(orderId: number | string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ action, payload }: { action: TransitionKey; payload?: TransitionPayload }) =>
      api.transition(orderId, action, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(orderKeys.detail(orderId), updated);
      void queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
      void queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      void queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
    },
  });
}

export function useAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (available: boolean) => api.setAvailability(available),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
    },
  });
}
