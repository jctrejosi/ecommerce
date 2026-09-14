import { http, uploadHttp, unwrap, apiErrorMessage } from "./client";
import type {
  DeliveryApi,
  ProofImageKind,
  RouteResult,
  TransitionPayload,
  TransitionKey,
} from "./contract";
import type {
  ChatMessage,
  DeliveryOrder,
  DriverUser,
  HistoryEntry,
  LocationPing,
  LoginResponse,
} from "./types";

/** Implementación real del contrato contra el backend NestJS. */
export const realApi: DeliveryApi = {
  async login(username, password) {
    try {
      const res = await http.post("/auth/login", { username, password });
      return unwrap<LoginResponse>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "Error al iniciar sesión."));
    }
  },

  async me() {
    try {
      const res = await http.get("/auth/me");
      return unwrap<DriverUser>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo validar la sesión."));
    }
  },

  async logout() {
    await http.post("/auth/logout");
  },

  async forgotPassword(email) {
    try {
      await http.post("/auth/forgot-password", { email });
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo enviar el correo."));
    }
  },

  async resetPassword(token, newPassword) {
    try {
      await http.post("/auth/reset-password", { token, newPassword });
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo restablecer la contraseña."));
    }
  },

  async getActiveOrders() {
    try {
      const res = await http.get("/orders");
      return unwrap<DeliveryOrder[]>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudieron cargar los pedidos."));
    }
  },

  async getOrder(id) {
    try {
      const res = await http.get(`/orders/${id}`);
      return unwrap<DeliveryOrder>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo cargar el pedido."));
    }
  },

  async getHistory() {
    try {
      const res = await http.get("/history");
      return unwrap<HistoryEntry[]>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo cargar el historial."));
    }
  },

  async getRoute(orderId, from, target?: "customer" | "store") {
    try {
      const res = await http.get(`/orders/${orderId}/route`, {
        params: { from, target },
      });
      return unwrap<RouteResult>(res.data);
    } catch {
      // Sin ruta (OSRM caído / sin coordenadas) se devuelve null y la app no
      // dibuja ninguna línea hasta que haya una ruta calculada.
      return null;
    }
  },

  async transition(orderId, action: TransitionKey, payload?: TransitionPayload) {
    try {
      const res = await http.post(`/orders/${orderId}/${action}`, payload ?? {});
      return unwrap<DeliveryOrder>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo actualizar el pedido."));
    }
  },

  async sendLocation(ping: LocationPing) {
    await http.post("/location", ping);
  },

  async setPushToken(token) {
    await http.put("/profile/push-token", { token });
  },

  async setAvailability(available) {
    try {
      const res = await http.put("/profile/availability", { isAvailable: available });
      return unwrap<DriverUser>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo actualizar la disponibilidad."));
    }
  },

  async getChatMessages(orderId) {
    try {
      const res = await http.get(`/orders/${orderId}/messages`);
      return unwrap<ChatMessage[]>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo cargar el chat."));
    }
  },

  async sendChatMessage(orderId, body) {
    try {
      const res = await http.post(`/orders/${orderId}/messages`, { body });
      return unwrap<ChatMessage>(res.data);
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo enviar el mensaje."));
    }
  },

  async uploadProofImage(uri, kind: ProofImageKind) {
    try {
      const form = new FormData();
      form.append("file", {
        uri,
        name: `delivery_${kind}_${Date.now()}.jpg`,
        type: "image/jpeg",
      } as unknown as Blob);
      form.append("code", "delivery_proofs");
      const res = await uploadHttp.post("/upload/image", form, {
        timeout: 30_000,
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = unwrap<{ url?: string }>(res.data);
      if (!data?.url) throw new Error("La subida no devolvió una URL.");
      return data.url;
    } catch (err) {
      throw new Error(apiErrorMessage(err, "No se pudo subir la foto."));
    }
  },
};
