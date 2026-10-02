import type {
  AssignmentStatus,
  DriverFilter,
  FleetDriver,
} from '../types';
import { isStale } from './format';

export interface StatusMeta {
  label: string;
  action: string;
  /** Color hex para el pin del mapa. */
  color: string;
  /** Clases tailwind para badges. */
  badge: string;
}

export const STATUS_META: Record<AssignmentStatus, StatusMeta> = {
  ASSIGNED: {
    label: 'Asignado',
    action: 'Pedido asignado · esperando aceptación',
    color: '#0ea5e9',
    badge: 'bg-sky-100 text-sky-700',
  },
  ACCEPTED: {
    label: 'Aceptado',
    action: 'De camino a la tienda',
    color: '#f59e0b',
    badge: 'bg-amber-100 text-amber-700',
  },
  READY_FOR_PICKUP: {
    label: 'Recogiendo',
    action: 'En la tienda · recogiendo el pedido',
    color: '#f97316',
    badge: 'bg-orange-100 text-orange-700',
  },
  PICKED_UP: {
    label: 'Pedido recogido',
    action: 'Pedido en su poder · por iniciar entrega',
    color: '#8b5cf6',
    badge: 'bg-violet-100 text-violet-700',
  },
  IN_DELIVERY: {
    label: 'En entrega',
    action: 'De camino al cliente',
    color: '#16a34a',
    badge: 'bg-green-100 text-green-700',
  },
  DELIVERED: {
    label: 'Entregado',
    action: 'Pedido entregado',
    color: '#16a34a',
    badge: 'bg-green-100 text-green-700',
  },
  REJECTED: {
    label: 'Rechazado',
    action: 'Rechazó la asignación',
    color: '#ef4444',
    badge: 'bg-red-100 text-red-700',
  },
  FAILED_DELIVERY: {
    label: 'Entrega fallida',
    action: 'No se pudo entregar',
    color: '#ef4444',
    badge: 'bg-red-100 text-red-700',
  },
  CANCELLED: {
    label: 'Cancelado',
    action: 'Pedido cancelado',
    color: '#64748b',
    badge: 'bg-gray-100 text-gray-600',
  },
};

export const ACTIVE_STATUSES: AssignmentStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'IN_DELIVERY',
];

export interface DriverVisual {
  color: string;
  label: string;
  action: string;
  badge: string;
}

/**
 * Última señal conocida del repartidor: el heartbeat de la app o el último ping
 * GPS, el que sea más reciente. `null` si nunca dio señal.
 */
export function lastSignalAt(d: FleetDriver): string | null {
  const seen = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0;
  const loc = d.lastLocationAt ? new Date(d.lastLocationAt).getTime() : 0;
  const latest = Math.max(seen, loc);
  return latest > 0 ? new Date(latest).toISOString() : null;
}

/**
 * ¿La app del repartidor sigue reportando? Requiere cuenta activa y una señal
 * dentro de la ventana de presencia; sin señal se considera desconectado.
 */
export function isDriverOnline(d: FleetDriver): boolean {
  return d.isActive && !isStale(lastSignalAt(d));
}

/** Estado visual de un repartidor según cuenta, señal y pedido activo. */
export function driverVisual(d: FleetDriver): DriverVisual {
  if (!d.isActive) {
    return {
      color: '#94a3b8',
      label: 'Desactivado',
      action: 'Cuenta desactivada',
      badge: 'bg-surface-3 text-ink-faint',
    };
  }
  const offline = !isDriverOnline(d);
  if (d.activeAssignment) {
    // El pedido en curso manda, pero si la app dejó de dar señal se avisa.
    const meta = STATUS_META[d.activeAssignment.status];
    return {
      color: meta.color,
      label: meta.label,
      action: offline ? `Sin señal · ${meta.action}` : meta.action,
      badge: meta.badge,
    };
  }
  if (offline) {
    return {
      color: '#94a3b8',
      label: 'Desconectado',
      action: 'Sin señal de la app · desconectado',
      badge: 'bg-surface-3 text-ink-faint',
    };
  }
  if (d.isAvailable) {
    return {
      color: '#34d399',
      label: 'Disponible',
      action: 'Disponible · sin pedido asignado',
      badge: 'bg-emerald-100 text-emerald-700',
    };
  }
  return {
    color: '#64748b',
    label: 'No disponible',
    action: 'Marcado como no disponible',
    badge: 'bg-line text-ink-soft',
  };
}

export function filterDrivers(
  drivers: FleetDriver[],
  filter: DriverFilter,
): FleetDriver[] {
  switch (filter) {
    case 'available':
      // Solo conectados: un repartidor sin señal no está disponible de verdad.
      return drivers.filter(
        (d) => isDriverOnline(d) && d.isAvailable && !d.activeAssignment,
      );
    case 'with-order':
      return drivers.filter((d) => d.isActive && d.activeAssignment);
    case 'in-delivery':
      return drivers.filter((d) => d.isActive && d.activeAssignment?.status === 'IN_DELIVERY');
    case 'offline':
      return drivers.filter((d) => d.isActive && !isDriverOnline(d));
    case 'inactive':
      return drivers.filter((d) => !d.isActive);
    default:
      return drivers;
  }
}

export const FILTER_OPTIONS: { key: DriverFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'available', label: 'Disponibles' },
  { key: 'with-order', label: 'Con pedido' },
  { key: 'in-delivery', label: 'En entrega' },
  { key: 'offline', label: 'Desconectados' },
  { key: 'inactive', label: 'Inactivos' },
];
