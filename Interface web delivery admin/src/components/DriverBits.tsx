import { MapPin, WifiOff } from 'lucide-react';
import type { ActiveAssignment, FleetDriver } from '../types';
import {
  STATUS_META,
  assignmentMilestone,
  driverVisual,
  isDriverOnline,
  lastSignalAt,
} from '../lib/status';
import { initials, timeAgo } from '../lib/format';

/** Avatar circular: foto de perfil si la tiene, si no iniciales con el color del estado. */
export function DriverAvatar({
  driver,
  size = 36,
}: {
  driver: FleetDriver;
  size?: number;
}) {
  const visual = driverVisual(driver);
  const offline = driver.isActive && !isDriverOnline(driver);
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      title={visual.action}
    >
      {driver.avatarUrl ? (
        <img
          src={driver.avatarUrl}
          alt={driver.fullName}
          className="h-full w-full rounded-full object-cover"
          style={{ opacity: driver.isActive ? 1 : 0.5 }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-bold text-white"
          style={{
            background: visual.color,
            fontSize: Math.max(10, size * 0.32),
            opacity: driver.isActive ? 1 : 0.5,
          }}
        >
          {initials(driver.fullName)}
        </div>
      )}
      {offline && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface">
          <WifiOff className="h-3 w-3 text-ink-faint" />
        </span>
      )}
    </div>
  );
}

/** Badge con el estado/acción actual del repartidor. */
export function StatusBadge({ driver }: { driver: FleetDriver }) {
  const visual = driverVisual(driver);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${visual.badge}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: visual.color }}
      />
      {visual.label}
    </span>
  );
}

/** Hora de la última señal de la app (heartbeat o GPS). */
export function LastSeen({ driver }: { driver: FleetDriver }) {
  const signal = lastSignalAt(driver);
  const offline = driver.isActive && !isDriverOnline(driver);
  return (
    <span
      className={`whitespace-nowrap text-xs ${offline ? 'font-semibold text-rose-500' : 'text-ink-faint'}`}
      title={signal ? new Date(signal).toLocaleString('es-CO') : 'Sin señal'}
    >
      {signal ? timeAgo(signal) : 'Sin señal'}
    </span>
  );
}

/**
 * Tarjeta destacada del pedido en curso: borde, fondo y pulso con el color del
 * estado, para que salte a la vista en el detalle del repartidor.
 */
export function ActiveOrderCard({ assignment }: { assignment: ActiveAssignment }) {
  const meta = STATUS_META[assignment.status];
  const milestone = assignmentMilestone(assignment);
  return (
    <div
      className="flex items-start gap-3 rounded-xl border px-3.5 py-3"
      style={{ borderColor: meta.color, background: `${meta.color}14` }}
    >
      <span aria-hidden="true" className="relative mt-1 flex h-3 w-3 shrink-0">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ background: meta.color }}
        />
        <span
          className="relative inline-flex h-3 w-3 rounded-full"
          style={{ background: meta.color }}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-bold text-ink">
            {assignment.referenceCode ?? `Pedido #${assignment.orderId}`}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.badge}`}>
            {meta.label}
          </span>
          {milestone?.at && (
            <span className="text-[10px] font-semibold text-ink-faint">
              {milestone.label} {timeAgo(milestone.at)}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-ink-soft">
          {assignment.customerName ?? 'Cliente'}
          {assignment.customerPhone ? ` · ${assignment.customerPhone}` : ''}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {[assignment.addressLine1, assignment.city].filter(Boolean).join(', ') ||
              'Sin dirección'}
          </span>
        </p>
        <p className="mt-1 text-[11px] font-semibold" style={{ color: meta.color }}>
          {meta.action}
        </p>
      </div>
    </div>
  );
}
