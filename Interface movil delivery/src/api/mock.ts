import type { DeliveryApi, TransitionKey, TransitionPayload } from "./contract";
import type {
  AdminChatMessage,
  AdminChatSummary,
  ChatMessage,
  DeliveryOrder,
  DriverUser,
  HistoryEntry,
  LocationPing,
  LoginResponse,
} from "./types";

/**
 * Mock en memoria del backend delivery. Permite probar TODA la app sin
 * backend (EXPO_PUBLIC_API_URL vacío o EXPO_PUBLIC_USE_MOCK=true).
 * Credenciales demo: `demo` / `demo1234`.
 */

const delay = (ms = 450) => new Promise<void>((r) => setTimeout(r, ms));

const demoUser: DriverUser = {
  id: 1,
  username: "demo",
  fullName: "Repartidor Demo",
  phone: "300 123 4567",
  email: "demo@dsi.com",
  role: "driver",
  vehicleType: "Motocicleta",
  vehiclePlate: "ABC-12D",
  vehicleBrand: "Yamaha",
  vehicleModel: "NMAX 2024",
  isAvailable: true,
  isActive: true,
};

const BOGOTA = { lat: 4.71099, lng: -74.07209 };

function event(ev: string, minutesAgo = 0, description?: string) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  return { event: ev, at: at.toISOString(), description: description ?? null };
}

function mkOrder(
  id: number,
  status: DeliveryOrder["status"],
  opts: Partial<DeliveryOrder> = {},
): DeliveryOrder {
  return {
    id,
    referenceCode: `MA-${1000 + id}`,
    status,
    customer: { name: "Juan Pérez", phone: "300 111 2222" },
    address: {
      line1: "Carrera 12 # 34-56",
      line2: "Apto 302",
      city: "Bogotá",
      notes: "Apartamento 302, llamar al llegar.",
    },
    destination: {
      lat: BOGOTA.lat + id * 0.0007,
      lng: BOGOTA.lng + id * 0.0005,
    },
    items: [
      { name: "Leche Entera Alquería 1.1 L", quantity: 2 },
      { name: "Arroz Diana Extra Premium 5 kg", quantity: 1 },
      { name: "Huevos AA Blancos x30", quantity: 1 },
    ],
    totals: { value: 45_000 + id * 1000, currency: "COP", shipping: 6_000 },
    payment: { method: "CASH", label: "Contraentrega" },
    pickup: {
      branch: {
        name: "Mercaldas Norte",
        address: "Calle 80 # 11-23",
        lat: BOGOTA.lat,
        lng: BOGOTA.lng,
      },
    },
    timeline: [event("ASSIGNED", 30)],
    assignedAt: event("ASSIGNED", 30).at,
    ...opts,
  };
}

const active: DeliveryOrder[] = [
  mkOrder(1, "ASSIGNED", {
    customer: { name: "María Rodríguez", phone: "311 222 3333" },
    totals: { value: 52_000, currency: "COP", shipping: 6_000 },
    payment: { method: "NEQUI", label: "Pagado" },
  }),
  mkOrder(2, "ACCEPTED", {
    customer: { name: "Carlos Gómez", phone: "320 444 5555" },
    timeline: [event("ASSIGNED", 55), event("ACCEPTED", 50)],
    acceptedAt: event("ACCEPTED", 50).at,
  }),
  mkOrder(3, "READY_FOR_PICKUP", {
    customer: { name: "Ana Torres", phone: "315 666 7777" },
    timeline: [event("ASSIGNED", 80), event("ACCEPTED", 75), event("ARRIVED", 70)],
    acceptedAt: event("ACCEPTED", 75).at,
  }),
  mkOrder(4, "PICKED_UP", {
    customer: { name: "Luis Herrera", phone: "310 888 9999" },
    timeline: [
      event("ASSIGNED", 100),
      event("ACCEPTED", 95),
      event("ARRIVED", 90),
      event("PICKED_UP", 85),
    ],
    acceptedAt: event("ACCEPTED", 95).at,
    pickedUpAt: event("PICKED_UP", 85).at,
  }),
  mkOrder(5, "IN_DELIVERY", {
    customer: { name: "Sofía Vargas", phone: "312 000 1111" },
    timeline: [
      event("ASSIGNED", 130),
      event("ACCEPTED", 125),
      event("ARRIVED", 120),
      event("PICKED_UP", 115),
      event("IN_DELIVERY", 110),
    ],
    acceptedAt: event("ACCEPTED", 125).at,
    pickedUpAt: event("PICKED_UP", 115).at,
  }),
];

const history: HistoryEntry[] = [
  {
    ...mkOrder(20, "DELIVERED", {
      customer: { name: "Pedro Ruiz", phone: "301 234 5678" },
      totals: { value: 38_900, currency: "COP", shipping: 6_000 },
    }),
    deliveredAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  },
  {
    ...mkOrder(19, "DELIVERED", {
      customer: { name: "Camila Díaz", phone: "302 345 6789" },
      totals: { value: 61_500, currency: "COP", shipping: 6_000 },
    }),
    deliveredAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
  {
    ...mkOrder(18, "FAILED_DELIVERY", {
      customer: { name: "Jorge León", phone: "303 456 7890" },
    }),
    deliveredAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
  },
];

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** Chat por pedido en memoria (solo modo mock). */
const chatStore = new Map<number, ChatMessage[]>();

/** Hilo con el panel (solo modo mock). */
const adminChatStore: AdminChatMessage[] = [];

function chatFor(orderId: number): ChatMessage[] {
  let msgs = chatStore.get(orderId);
  if (!msgs) {
    msgs = [
      {
        id: `seed-${orderId}-1`,
        senderType: "customer",
        body: "¡Hola! ¿Ya vienes en camino con mi pedido? 😊",
        createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
      {
        id: `seed-${orderId}-2`,
        senderType: "delivery",
        body: "¡Sí! Voy en camino, llego pronto 🛵",
        createdAt: new Date(Date.now() - 9 * 60_000).toISOString(),
      },
    ];
    chatStore.set(orderId, msgs);
  }
  return msgs;
}

let autoAssigned = false;

const TRANSITION_EVENTS: Record<TransitionKey, string> = {
  accept: "ACCEPTED",
  reject: "REJECTED",
  arrived: "ARRIVED",
  pickup: "IN_DELIVERY",
  start: "IN_DELIVERY",
  deliver: "DELIVERED",
  fail: "FAILED_DELIVERY",
};

export const mockApi: DeliveryApi = {
  async login(username, password) {
    await delay(700);
    if (username === "demo" && password === "demo1234") {
      return { accessToken: "mock-token", refreshToken: "mock-refresh", expiresIn: 3600, user: clone(demoUser) };
    }
    throw new Error("Credenciales inválidas. Usa demo / demo1234 en modo mock.");
  },

  async me() {
    await delay(200);
    return clone(demoUser);
  },

  async logout() {
    await delay(150);
  },

  async forgotPassword(email) {
    await delay(600);
    if (!email.includes("@")) throw new Error("Ingresa un correo válido.");
  },

  async resetPassword(token, newPassword) {
    await delay(600);
    if (newPassword.length < 6) {
      throw new Error("La contraseña debe tener al menos 6 caracteres.");
    }
  },

  async getActiveOrders() {
    await delay(400);
    // Simula la llegada de un pedido nuevo una sola vez (como el push/socket).
    if (!autoAssigned) {
      autoAssigned = true;
      setTimeout(() => {
        active.unshift(
          mkOrder(6, "ASSIGNED", {
            customer: { name: "Nuevo Cliente", phone: "318 999 0000" },
            totals: { value: 27_800, currency: "COP", shipping: 6_000 },
            timeline: [event("ASSIGNED", 0)],
            assignedAt: new Date().toISOString(),
          }),
        );
      }, 15_000);
    }
    return clone(active);
  },

  async getOrder(id) {
    await delay(300);
    const num = Number(id);
    const found = active.find((o) => o.id === num) ?? history.find((o) => o.id === num);
    if (!found) throw new Error("Pedido no encontrado");
    return clone(found);
  },

  async getHistory() {
    await delay(400);
    return clone(history);
  },

  async getRoute(_orderId, _from, _target) {
    // En mock no hay motor de rutas: no se dibuja ruta.
    return null;
  },

  async transition(orderId, action, payload?: TransitionPayload) {
    await delay(600);
    const num = Number(orderId);
    const idx = active.findIndex((o) => o.id === num);
    if (idx === -1) throw new Error("Pedido no encontrado");
    const order = active[idx];

    const allowed: Record<string, TransitionKey[]> = {
      ASSIGNED: ["accept", "reject"],
      ACCEPTED: ["arrived"],
      READY_FOR_PICKUP: ["pickup"],
      PICKED_UP: ["start"],
      IN_DELIVERY: ["deliver", "fail"],
    };
    if (!allowed[order.status]?.includes(action)) {
      throw new Error(`Acción no permitida en estado ${order.status}`);
    }
    if ((action === "reject" || action === "fail") && !payload?.reason) {
      throw new Error("Debes indicar un motivo.");
    }

    const nextStatus: Record<TransitionKey, DeliveryOrder["status"]> = {
      accept: "ACCEPTED",
      reject: "REJECTED",
      arrived: "READY_FOR_PICKUP",
      // "Tengo el pedido" pasa directo a en camino.
      pickup: "IN_DELIVERY",
      start: "IN_DELIVERY",
      deliver: "DELIVERED",
      fail: "FAILED_DELIVERY",
    };

    order.status = nextStatus[action];
    order.timeline.push({
      event: TRANSITION_EVENTS[action],
      at: new Date().toISOString(),
      description: payload?.reason ?? payload?.note ?? null,
    });
    if (action === "accept") order.acceptedAt = new Date().toISOString();
    if (action === "pickup") order.pickedUpAt = new Date().toISOString();
    if (action === "reject") order.rejectReason = payload?.reason ?? null;
    if (action === "deliver") {
      order.completedAt = new Date().toISOString();
      active.splice(idx, 1);
      history.unshift({ ...clone(order), deliveredAt: new Date().toISOString() });
    }
    if (action === "fail" || action === "reject") {
      active.splice(idx, 1);
      history.unshift({ ...clone(order), deliveredAt: new Date().toISOString() });
    }
    return clone(order);
  },

  async sendLocation(_ping: LocationPing) {
    // El mock descarta los pings; la cola se vacía para no crecer.
  },

  async sendHeartbeat() {
    // El mock no tiene backend que registrar la presencia.
  },

  async setPushToken(_token) {},

  async uploadProofImage(_uri, kind) {
    await delay(400);
    return `https://mock.media/delivery/${kind}-${Date.now()}.jpg`;
  },

  async setAvailability(available) {
    await delay(300);
    return { ...clone(demoUser), isAvailable: available };
  },

  async getChatMessages(orderId) {
    await delay(250);
    return clone(chatFor(Number(orderId)));
  },

  async sendChatMessage(orderId, body) {
    await delay(250);
    const msg: ChatMessage = {
      id: `m-${Date.now()}`,
      senderType: "delivery",
      body,
      createdAt: new Date().toISOString(),
    };
    chatFor(Number(orderId)).push(msg);
    return clone(msg);
  },

  async getAdminChatMessages() {
    await delay(200);
    return clone(adminChatStore);
  },

  async sendAdminChatMessage(body) {
    await delay(200);
    const msg: AdminChatMessage = {
      id: Date.now(),
      senderType: "driver",
      senderUserId: null,
      body,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    adminChatStore.push(msg);
    return clone(msg);
  },

  async getAdminChatSummary() {
    await delay(150);
    const last = adminChatStore[adminChatStore.length - 1] ?? null;
    return clone({
      unread: adminChatStore.filter(
        (m) => m.senderType === "admin" && m.readAt == null,
      ).length,
      lastMessage: last,
    });
  },
};
