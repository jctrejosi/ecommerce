import type { OrderStatus, PickingItem, PickingOrder } from "@/api";

/** Deriva el estado mostrado en la cola a partir del status crudo del backend. */
export function orderStatus(order: Pick<PickingOrder, "status">): OrderStatus {
  // El pedido ya salió de alistamiento: "ready" (listo para entrega) o más
  // adelante recogido ("shipped") / entregado ("delivered").
  if (
    order.status === "ready" ||
    order.status === "shipped" ||
    order.status === "delivered"
  ) {
    return "completado";
  }
  if (order.status === "preparing") return "preparando";
  return "nuevo";
}

export function isItemDone(item: PickingItem): boolean {
  return item.pickedQty >= item.quantity;
}

export function scannedCount(items: PickingItem[]): number {
  return items.filter(isItemDone).length;
}

/** Más antiguos primero; los no revisados por delante. */
export function sortQueue(orders: PickingOrder[]): PickingOrder[] {
  return [...orders].sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
