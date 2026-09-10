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
  /** URL de la foto del lugar de entrega (subida previamente). */
  proofLocationUrl?: string;
  /** URL de la foto del pedido entregado (subida previamente). */
  proofPackageUrl?: string;
}

/** Tipo de foto de la prueba de entrega. */
export type ProofImageKind = "location" | "package";

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

  // ruta (OSRM): devuelve null cuando no hay ruta disponible; la app no dibuja
  // línea hasta que haya una ruta calculada.
  getRoute(
    orderId: number | string,
    from?: string,
    target?: "customer" | "store",
  ): Promise<RouteResult | null>;

  // transiciones de estado
  transition(
    orderId: number | string,
    action: TransitionKey,
    payload?: TransitionPayload,
  ): Promise<DeliveryOrder>;

  // sube una foto de la prueba de entrega y devuelve la URL publicada
  uploadProofImage(uri: string, kind: ProofImageKind): Promise<string>;

  // tracking / perfil / notificaciones
  sendLocation(ping: LocationPing): Promise<void>;
  setPushToken(token: string): Promise<void>;
  setAvailability(available: boolean): Promise<DriverUser>;
}
