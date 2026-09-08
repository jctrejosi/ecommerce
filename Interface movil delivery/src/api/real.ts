import { http, unwrap, apiErrorMessage } from "./client";
import type { DeliveryApi, TransitionPayload, TransitionKey } from "./contract";
import type {
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
};
