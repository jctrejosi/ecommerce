import { getAuthHeaders } from "./customer-auth.service";

import type { Order } from "../app/types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export type CheckoutItem = {
  productId: number;
  quantity: number;
};

export type CheckoutAddress = {
  name: string;
  phone: string;
  address: string;
  city: string;
  notes?: string;
};

export type CardPaymentProvider = "epayco" | "wompi";

export type CardPaymentDetails = {
  provider?: CardPaymentProvider;
  cardholderName: string;
  cardToken: string;
  acceptanceToken?: string;
  acceptPersonalAuth?: string;
  last4: string;
  brand: string;
  installments?: number;
};

export type PsePaymentDetails = {
  bank: string;
  personType: "natural" | "juridica";
};

export type NequiPaymentDetails = {
  phone: string;
};

export type CheckoutPayload = {
  items: CheckoutItem[];
  address: CheckoutAddress;
  shippingType: "standard" | "express";
  paymentMethod: "efectivo" | "tarjeta" | "nequi" | "pse" | "breb";
  paymentDetails?: {
    card?: CardPaymentDetails;
    pse?: PsePaymentDetails;
    nequi?: NequiPaymentDetails;
  };
};

export type CheckoutResponse = {
  orderId: number;
  referenceCode: string;
  subtotal: number;
  shippingCost: number;
  grandTotal: number;
  paymentMethod: CheckoutPayload["paymentMethod"];
  shippingType: CheckoutPayload["shippingType"];
  address: CheckoutAddress;
  status: string;
  cardTransaction?: Record<string, unknown>;
};

export type EpaycoConfigResponse = {
  publicKey: string;
  checkoutUrl: string;
  test: boolean;
};

export type WompiConfigResponse = {
  publicKey: string;
  redirectUrl: string | null;
  acceptanceToken: string | null;
  acceptancePermalink: string | null;
  personalDataAuthToken: string | null;
  personalDataAuthPermalink: string | null;
};

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message = Array.isArray(json?.message)
      ? json.message.join(", ")
      : json?.message || json?.error?.reason;
    throw new Error(message || "Error en la solicitud");
  }

  return json;
}

export const ordersService = {
  async getEpaycoConfig(): Promise<EpaycoConfigResponse> {
    return fetchJson<EpaycoConfigResponse>(`${API_BASE_URL}/payments/epayco/config`, {
      credentials: "include",
    });
  },

  async tokenizeEpaycoCard(input: {
    cardNumber: string;
    expYear: string;
    expMonth: string;
    cvc: string;
    cardHolder: string;
  }): Promise<{ id: string; brand: string; last4: string }> {
    return fetchJson<{ id: string; brand: string; last4: string }>(
      `${API_BASE_URL}/payments/epayco/tokenize-card`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  },

  async getWompiConfig(): Promise<WompiConfigResponse> {
    return fetchJson<WompiConfigResponse>(`${API_BASE_URL}/payments/wompi/config`, {
      credentials: "include",
      cache: "no-store",
    });
  },

  async tokenizeWompiCard(input: {
    publicKey: string;
    number: string;
    cvc: string;
    expMonth: string;
    expYear: string;
    cardHolder: string;
  }): Promise<{ id: string; brand: string; last_four: string }> {
    // El endpoint depende del ambiente de la llave: pub_stag_ = sandbox, pub_prod_ = producción.
    const wompiApi = input.publicKey.startsWith("pub_stag_")
      ? "https://sandbox.wompi.co/v1"
      : "https://api.wompi.co/v1";
    const response = await fetchJson<{ data: { id: string; brand: string; last_four: string } }>(
      `${wompiApi}/tokens/cards`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.publicKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number: input.number,
          cvc: input.cvc,
          exp_month: input.expMonth,
          exp_year: input.expYear,
          card_holder: input.cardHolder,
        }),
      },
    );

    return response.data;
  },

  async checkout(payload: CheckoutPayload): Promise<CheckoutResponse> {
    return fetchJson<CheckoutResponse>(`${API_BASE_URL}/orders/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
  },

  /** Checkout sin iniciar sesión: el backend crea la sesión invitado solo. */
  async checkoutGuest(payload: CheckoutPayload): Promise<CheckoutResponse> {
    return fetchJson<CheckoutResponse>(`${API_BASE_URL}/orders/guest-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
  },

  /** Consulta pública de un pedido por su código de referencia. */
  async trackOrder(referenceCode: string): Promise<Order> {
    const raw = await fetchJson<{
      id: string;
      date: string;
      items: Array<{
        id: string | number;
        name: string;
        image?: string | null;
        quantity: number;
        price: number;
        category?: string;
      }>;
      total: number;
      shipping: number;
      address: string;
      paymentMethod: string;
      status: Order["status"];
    }>(`${API_BASE_URL}/orders/track/${encodeURIComponent(referenceCode.trim())}`);

    return {
      id: raw.id,
      date: raw.date
        ? new Date(raw.date).toLocaleDateString("es-CO", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })
        : "",
      items: (raw.items ?? []).map((i) => ({
        id: typeof i.id === "number" ? i.id : i.id || i.name,
        name: i.name,
        image: i.image ?? undefined,
        quantity: i.quantity,
        price: i.price,
        category: i.category ?? "",
      })),
      total: raw.total,
      shipping: raw.shipping,
      address: raw.address,
      paymentMethod: raw.paymentMethod,
      status: raw.status,
    };
  },

  async getOrders(): Promise<Order[]> {
    return fetchJson<Order[]>(`${API_BASE_URL}/orders`, {
      credentials: "include",
    });
  },

  /** Seguimiento en vivo de la entrega (público, por código de pedido). */
  async liveTracking(referenceCode: string): Promise<OrderLiveTracking> {
    return fetchJson<OrderLiveTracking>(
      `${API_BASE_URL}/orders/track/${encodeURIComponent(referenceCode.trim())}/live`,
    );
  },

  /** Ruta por calles (OSRM) repartidor → domicilio (público, por código). */
  async liveRoute(referenceCode: string): Promise<OrderLiveRoute | null> {
    return fetchJson<OrderLiveRoute | null>(
      `${API_BASE_URL}/orders/track/${encodeURIComponent(referenceCode.trim())}/route`,
    );
  },

  /** Mensajes del chat del pedido (cliente ↔ repartidor). */
  async chatMessages(referenceCode: string): Promise<OrderChatMessage[]> {
    return fetchJson<OrderChatMessage[]>(
      `${API_BASE_URL}/orders/track/${encodeURIComponent(referenceCode.trim())}/messages`,
    );
  },

  /** Envía un mensaje del cliente en el chat del pedido. */
  async sendChatMessage(
    referenceCode: string,
    body: string,
  ): Promise<OrderChatMessage> {
    return fetchJson<OrderChatMessage>(
      `${API_BASE_URL}/orders/track/${encodeURIComponent(referenceCode.trim())}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
  },
};

export type OrderChatMessage = {
  id: string;
  /** Quién escribió: 'customer' (tú) o 'delivery' (tu repartidor). */
  senderType: "customer" | "delivery";
  body: string;
  createdAt: string | null;
};

export type Point = { lat: number; lng: number };

/** Ruta por calles (OSRM) entre el repartidor y el domicilio. */
export type OrderLiveRoute = {
  /** Polyline (precisión 5) lista para decodificar a coordenadas. */
  polyline: string;
  distanceM: number;
  durationS: number;
};

export type OrderLiveTracking = {
  referenceCode: string;
  /** Estado visible para el cliente (preparando/en camino/entregado…). */
  status: string;
  /** Estado real de la entrega (ASSIGNED…IN_DELIVERY/DELIVERED…). */
  deliveryStatus: string | null;
  driver: {
    name: string;
    vehicleType: string | null;
    vehiclePlate: string | null;
    location: Point | null;
    lastLocationAt: string | null;
  } | null;
  branch: {
    name: string;
    address: string | null;
    location: Point | null;
  } | null;
  destination: {
    address: string;
    location: Point | null;
  };
  updatedAt: string | null;
};
