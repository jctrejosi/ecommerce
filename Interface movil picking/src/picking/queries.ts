import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { pickingApi } from "@/api";
import type { PickingOrder } from "@/api";

export const PICKING_ROOT = ["picking"] as const;

export const pickingKeys = {
  root: PICKING_ROOT,
  queue: () => ["picking", "queue"] as const,
  order: (id: number) => ["picking", "order", id] as const,
  pickers: () => ["picking", "pickers"] as const,
  shelves: (branchId: number) => ["picking", "shelves", branchId] as const,
  locations: (branchId: number, variantIds: number[]) =>
    ["picking", "locations", branchId, variantIds.join(",")] as const,
};

/** Cola completa de pedidos (se filtra por estado en el cliente). Refresca cada 20 s. */
export function useQueue() {
  return useQuery({
    queryKey: pickingKeys.queue(),
    queryFn: () => pickingApi.queue(),
    refetchInterval: 20_000,
  });
}

export function useOrder(id: number | undefined) {
  return useQuery({
    queryKey: pickingKeys.order(id ?? 0),
    queryFn: () => pickingApi.detail(id!),
    enabled: id !== undefined && Number.isFinite(id),
  });
}

export function usePickers() {
  return useQuery({
    queryKey: pickingKeys.pickers(),
    queryFn: () => pickingApi.pickers(),
    staleTime: 5 * 60_000,
  });
}

export function useShelves(branchId: number | undefined) {
  return useQuery({
    queryKey: pickingKeys.shelves(branchId ?? 0),
    queryFn: () => pickingApi.shelves(branchId!),
    enabled: branchId !== undefined,
  });
}

export function useLocations(branchId: number | undefined, variantIds: number[]) {
  return useQuery({
    queryKey: pickingKeys.locations(branchId ?? 0, variantIds),
    queryFn: () => pickingApi.locations(branchId!, variantIds),
    enabled: branchId !== undefined && variantIds.length > 0,
  });
}

/** Reclama el pedido para un picker (se dispara al abrir el detalle). */
export function useClaimOrder() {
  return useMutation({
    mutationFn: ({ orderId, pickerId }: { orderId: number; pickerId: number }) =>
      pickingApi.claim(orderId, pickerId),
  });
}

export function useMarkReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => pickingApi.markReviewed(orderId),
    onSuccess: (_res, orderId) => {
      qc.setQueryData<PickingOrder | undefined>(pickingKeys.order(orderId), (prev) =>
        prev ? { ...prev, reviewed: true } : prev,
      );
      void qc.invalidateQueries({ queryKey: PICKING_ROOT });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: PICKING_ROOT });
    },
  });
}

/** Escanea un código. Devuelve el `ScanResult` para feedback inmediato. */
export function useScan(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => pickingApi.scan(orderId, code),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pickingKeys.order(orderId) });
      void qc.invalidateQueries({ queryKey: PICKING_ROOT });
    },
  });
}

/** Confirma la entrega en caja. */
export function useCompleteOrder(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => pickingApi.complete(orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pickingKeys.order(orderId) });
      void qc.invalidateQueries({ queryKey: PICKING_ROOT });
    },
  });
}
