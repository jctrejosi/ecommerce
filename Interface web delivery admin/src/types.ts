export type AssignmentStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'IN_DELIVERY'
  | 'DELIVERED'
  | 'REJECTED'
  | 'FAILED_DELIVERY'
  | 'CANCELLED';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ActiveAssignment {
  assignmentId: number;
  orderId: number;
  referenceCode: string | null;
  status: AssignmentStatus;
  assignedAt: string | null;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  inDeliveryAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  destination: LatLng | null;
  addressLine1: string | null;
  city: string | null;
  branchName: string | null;
  branchLocation: LatLng | null;
}

export interface FleetDriver {
  id: number;
  fullName: string;
  phone: string;
  email: string | null;
  username: string | null;
  vehicleType: string | null;
  vehiclePlate: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  /** Color (#RRGGBB) de la ruta del repartidor en el mapa de flota. */
  routeColor: string | null;
  /** Foto de perfil (Cloudinary); null si no tiene. */
  avatarUrl: string | null;
  /** Capacidad de carga del vehículo en cm³ (null = sin declarar). */
  cargoVolumeCm3: number | null;
  /** Cupo comprometido: lo que ya lleva encima en pedidos activos. */
  load?: DriverLoad | null;
  isAvailable: boolean;
  isActive: boolean;
  location: LatLng | null;
  lastLocationAt: string | null;
  /** Última señal de la app (heartbeat o GPS), lo más reciente. */
  lastSeenAt: string | null;
  createdAt: string;
  activeAssignment: ActiveAssignment | null;
}

export interface FleetOrder {
  assignmentId: number;
  driverId: number;
  driverName: string;
  driverPlate: string | null;
  driverAvailable: boolean;
  orderId: number;
  referenceCode: string;
  status: AssignmentStatus;
  assignedAt: string | null;
  acceptedAt: string | null;
  readyForPickupAt: string | null;
  pickedUpAt: string | null;
  inDeliveryAt: string | null;
  completedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  addressLine1: string | null;
  city: string | null;
  notes: string | null;
  destination: LatLng | null;
  branchName: string | null;
  branchAddress: string | null;
  branchLocation: LatLng | null;
  totals: { value: number; currency: string };
  payment: { method: string; label: string };
  /** Volumen del pedido en cm³ (null = aún no calculado). */
  volume: { cm3: number | null; estimated: boolean };
}

/** Página de pedidos de la pestaña "Pedidos" (lazyload de 20 en 20). */
export interface OrderPage {
  items: FleetOrder[];
  /** Total de pedidos que cumplen el filtro (no solo los cargados). */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Cupo comprometido del repartidor (volumen de sus pedidos activos). */
export interface DriverLoad {
  driverId: number;
  /** Capacidad declarada del vehículo en cm³ (null = sin declarar). */
  capacityCm3: number | null;
  /** Volumen comprometido en pedidos activos. */
  usedCm3: number;
  /** Pedidos activos que consumen cupo. */
  orders: number;
  /** true si algún pedido activo tiene volumen estimado. */
  estimated: boolean;
  /** Ocupación 0..1 (null si no hay capacidad declarada). */
  fill: number | null;
  /** true si la carga supera la capacidad declarada. */
  overloaded: boolean;
}

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** Foto de perfil (Cloudinary); null si no tiene. */
  avatarUrl?: string | null;
  isSuperuser: boolean;
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: AuthUser;
}

export type DriverFilter =
  | 'all'
  | 'available'
  | 'with-order'
  | 'in-delivery'
  | 'offline'
  | 'inactive';

/** Lado que escribió un mensaje del chat repartidor ↔ admin. */
export type ChatSide = 'driver' | 'admin';

export interface DriverChatMessage {
  id: number;
  senderType: ChatSide;
  senderUserId: number | null;
  body: string;
  createdAt: string | null;
  readAt: string | null;
}

/** Renglón de la bandeja de chat: un hilo por repartidor. */
export interface DriverConversation {
  driverId: number;
  fullName: string;
  phone: string;
  /** Usuario de acceso del repartidor (el "código" que se ve en el panel). */
  username: string | null;
  routeColor: string | null;
  isActive: boolean;
  unread: number;
  lastMessage: {
    body: string;
    senderType: ChatSide;
    createdAt: string | null;
  } | null;
}
