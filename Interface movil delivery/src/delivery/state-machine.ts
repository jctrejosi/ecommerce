import type { DeliveryStatus } from "@/api/types";
import type { TransitionKey } from "@/api/contract";

/** Estados en los que el pedido sigue "activo" para el repartidor. */
export const ACTIVE_STATUSES: DeliveryStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "IN_DELIVERY",
];

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  ASSIGNED: "Asignado",
  ACCEPTED: "Aceptado",
  READY_FOR_PICKUP: "Listo para recoger",
  PICKED_UP: "Recogido",
  IN_DELIVERY: "En camino",
  DELIVERED: "Entregado",
  REJECTED: "Rechazado",
  FAILED_DELIVERY: "Entrega fallida",
  CANCELLED: "Cancelado",
};

export const STATUS_COLORS: Record<
  DeliveryStatus,
  { bg: string; fg: string }
> = {
  ASSIGNED: { bg: "#FFFBEB", fg: "#D97706" },
  ACCEPTED: { bg: "#EFF3FF", fg: "#2563EB" },
  READY_FOR_PICKUP: { bg: "#F1F5F9", fg: "#475569" },
  PICKED_UP: { bg: "#EFF6FF", fg: "#0284C7" },
  IN_DELIVERY: { bg: "#F5F3FF", fg: "#7C3AED" },
  DELIVERED: { bg: "#ECFDF5", fg: "#16A34A" },
  REJECTED: { bg: "#FEF2F2", fg: "#DC2626" },
  FAILED_DELIVERY: { bg: "#FEF2F2", fg: "#DC2626" },
  CANCELLED: { bg: "#F1F5F9", fg: "#94A3B8" },
};

export interface StateAction {
  key: TransitionKey;
  label: string;
  /** true si pide un motivo obligatorio (reject/fail). */
  requiresReason?: boolean;
  variant: "primary" | "secondary" | "danger";
}

/** Acciones disponibles según el estado (espejo UI de la máquina server-side). */
export const ACTIONS_BY_STATUS: Partial<Record<DeliveryStatus, StateAction[]>> = {
  ASSIGNED: [
    { key: "accept", label: "ACEPTAR PEDIDO", variant: "primary" },
    { key: "reject", label: "Rechazar", requiresReason: true, variant: "secondary" },
  ],
  ACCEPTED: [{ key: "arrived", label: "LLEGUÉ A LA TIENDA", variant: "primary" }],
  READY_FOR_PICKUP: [{ key: "pickup", label: "TENGO EL PEDIDO", variant: "primary" }],
  PICKED_UP: [{ key: "start", label: "INICIAR ENTREGA", variant: "primary" }],
  IN_DELIVERY: [
    { key: "deliver", label: "CONFIRMAR ENTREGA", variant: "primary" },
    { key: "fail", label: "No se pudo entregar", requiresReason: true, variant: "danger" },
  ],
};

export function actionsFor(status: DeliveryStatus): StateAction[] {
  return ACTIONS_BY_STATUS[status] ?? [];
}
