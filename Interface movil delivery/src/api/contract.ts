import type {
  DeliveryOrder,
  DriverUser,
  HistoryEntry,
  LatLng,
  LocationPing,
  LoginResponse,
} from "./types";

export type TransitionKey =
  | "accept"
  | "reject"
  | "arrived"
  | "pickup"
  | "start"
  | "deliver"
  | "fail";

export interface TransitionPayload {
  reason?: string;
  lat?: number;
  lng?: number;
  note?: string;
}

export interface RouteResult {
  polyline: string;
  distanceM: number;
  durationS: number;
}

/**
 * Contrato del backend delivery (mismo que docs/maquina-de-estados.md).
 * `mock.ts` implementa la misma interfaz para desarrollo sin backend.
 */
export interface DeliveryApi {
  // auth
  login(username: string, password: string): Promise<LoginResponse>;
  me(): Promise<DriverUser>;
  logout(): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;

  // pedidos
  getActiveOrders(): Promise<DeliveryOrder[]>;
  getOrder(id: number | string): Promise<DeliveryOrder>;
  getHistory(): Promise<HistoryEntry[]>;

  // ruta (OSRM): devuelve null cuando no hay ruta disponible (se degrada a línea recta)
  getRoute(orderId: number | string, from?: string): Promise<RouteResult | null>;

  // transiciones de estado
  transition(
    orderId: number | string,
    action: TransitionKey,
    payload?: TransitionPayload,
  ): Promise<DeliveryOrder>;

  // tracking / perfil / notificaciones
  sendLocation(ping: LocationPing): Promise<void>;
  setPushToken(token: string): Promise<void>;
  setAvailability(available: boolean): Promise<DriverUser>;
}
