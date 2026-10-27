import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { pickingApi } from "@/api";
import type { PickingOrder } from "@/api";

export const PICKING_ROOT = ["picking"] as const;

export const pickingKeys = {
  root: PICKING_ROOT,
  queue: () => ["picking", "queue"] as const,
  unreviewed: () => ["picking", "unreviewed"] as const,
  order: (id: number) => ["picking", "order", id] as const,
  history: () => ["picking", "history"] as const,
  shelves: (branchId: number) => ["picking", "shelves", branchId] as const,
  breaks: () => ["picking", "breaks"] as const,
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

/**
 * Pedidos pendientes de revisar (los que siguen en la cola de trabajo). Es una
 * de las dos fuentes del contador del ícono de la app.
 */
export function useUnreviewedCount() {
  return useQuery({
    queryKey: pickingKeys.unreviewed(),
    queryFn: () => pickingApi.unreviewedCount(),
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

/**
 * Historial del picker paginado de 10: cada página pide el offset según lo ya
 * cargado, para que la pantalla haga lazy load al llegar al final.
 */
export function useHistory() {
  return useInfiniteQuery({
    queryKey: pickingKeys.history(),
    queryFn: ({ pageParam }) => pickingApi.history(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((n, page) => n + page.orders.length, 0);
    },
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

/** Banco de descanso y avance de la meta diaria (se refresca solo). */
export function useBreaks(enabled = true) {
  return useQuery({
    queryKey: pickingKeys.breaks(),
    queryFn: () => pickingApi.breaks(),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

/** Reclama minutos del banco y deja el resumen actualizado. */
export function useUseBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number) => pickingApi.useBreak(minutes),
    onSuccess: (data) => {
      qc.setQueryData(pickingKeys.breaks(), data);
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

/**
 * Marca un ítem como alistado sin escanear (check manual): útil cuando el lector
 * no está disponible o el código no está impreso.
 */
export function useConfirmItem(orderId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => pickingApi.pickItem(orderId, itemId),
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
