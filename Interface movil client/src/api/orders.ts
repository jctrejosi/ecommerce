import { apiFetch } from "./client";
import type { Order } from "./types";

export interface CheckoutItem {
  productId: number;
  quantity: number;
}
export interface CheckoutAddress {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  notes?: string;
}
export type PaymentMethod = "efectivo" | "tarjeta" | "nequi" | "pse" | "breb";

export interface CheckoutPayload {
  items: CheckoutItem[];
  address: CheckoutAddress;
  shippingType: "standard" | "express";
  paymentMethod: PaymentMethod;
}

export interface CheckoutResponse {
  orderId: number;
  referenceCode: string;
  subtotal: number;
  shippingCost: number;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  shippingType: "standard" | "express";
  address: CheckoutAddress;
  status: string;
  cardTransaction?: Record<string, unknown>;
}

export interface Point {
  lat: number;
  lng: number;
}

export interface OrderLiveTracking {
  referenceCode: string;
  status: string;
  deliveryStatus: string | null;
  driver: {
    name: string;
    vehicleType: string | null;
    vehiclePlate: string | null;
    location: Point | null;
    lastLocationAt: string | null;
  } | null;
  branch: { name: string; address: string | null; location: Point | null } | null;
  destination: { address: string; location: Point | null };
  updatedAt: string | null;
}

export interface OrderLiveRoute {
  polyline: string;
  distanceM: number;
  durationS: number;
}

export const ordersApi = {
  checkout(payload: CheckoutPayload): Promise<CheckoutResponse> {
    return apiFetch<CheckoutResponse>("/orders/checkout", {
      method: "POST",
      auth: true,
      body: payload,
    });
  },

  guestCheckout(payload: CheckoutPayload): Promise<CheckoutResponse> {
    return apiFetch<CheckoutResponse>("/orders/guest-checkout", {
      method: "POST",
      body: payload,
    });
  },

  getOrders(): Promise<Order[]> {
    return apiFetch<Order[]>("/orders", { auth: true });
  },

  trackOrder(referenceCode: string): Promise<Order> {
    return apiFetch<Order>(`/orders/track/${encodeURIComponent(referenceCode)}`);
  },

  liveTracking(referenceCode: string): Promise<OrderLiveTracking> {
    return apiFetch<OrderLiveTracking>(
      `/orders/track/${encodeURIComponent(referenceCode)}/live`,
    );
  },

  liveRoute(referenceCode: string): Promise<OrderLiveRoute | null> {
    return apiFetch<OrderLiveRoute | null>(
      `/orders/track/${encodeURIComponent(referenceCode)}/route`,
    );
  },
};
