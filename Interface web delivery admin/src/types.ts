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
  isAvailable: boolean;
  isActive: boolean;
  location: LatLng | null;
  lastLocationAt: string | null;
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
}

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  fullName: string;
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
  | 'inactive';
