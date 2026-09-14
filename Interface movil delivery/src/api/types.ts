/**
 * Tipos del contrato delivery (mismo contrato definido en
 * docs/maquina-de-estados.md y docs/modelo-de-datos.md).
 */

export type DeliveryStatus =
  | "ASSIGNED"
  | "ACCEPTED"
  | "READY_FOR_PICKUP"
  | "PICKED_UP"
  | "IN_DELIVERY"
  | "DELIVERED"
  | "REJECTED"
  | "FAILED_DELIVERY"
  | "CANCELLED";

export interface DriverUser {
  id: number | string;
  username: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  role: "driver" | string;
  vehicleType?: string | null;
  vehiclePlate?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  isAvailable?: boolean;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: DriverUser;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocationPing extends LatLng {
  speed?: number | null;
  heading?: number | null;
  timestamp: string;
}

export interface OrderItem {
  name: string;
  quantity: number;
  unit?: string | null;
  /** URL de la imagen cover del producto (media.path); null si no tiene. */
  image?: string | null;
}

/** Mensaje del chat por pedido (repartidor ↔ cliente). */
export interface ChatMessage {
  id: string;
  senderType: "customer" | "delivery";
  body: string;
  createdAt: string | null;
}

export interface OrderCustomer {
  name: string;
  phone: string;
}

export interface OrderAddress {
  line1: string;
  line2?: string | null;
  city?: string | null;
  notes?: string | null;
}

export interface OrderPayment {
  method: string;
  label: string; // "Pagado" | "Contraentrega"
}

export interface OrderPickup {
  branch: {
    name: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
}

export interface TimelineEvent {
  event: string;
  at: string;
  description?: string | null;
}

export interface DeliveryOrder {
  id: number | string;
  referenceCode: string;
  status: DeliveryStatus;
  customer: OrderCustomer;
  address: OrderAddress;
  destination: LatLng | null;
  items: OrderItem[];
  totals: {
    value: number;
    currency?: string;
    shipping?: number;
  };
  payment: OrderPayment;
  pickup: OrderPickup;
  timeline: TimelineEvent[];
  assignedAt?: string | null;
  acceptedAt?: string | null;
  pickedUpAt?: string | null;
  completedAt?: string | null;
  rejectReason?: string | null;
}

export interface HistoryEntry extends DeliveryOrder {
  deliveredAt?: string | null;
}
