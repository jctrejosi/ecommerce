import { WifiOff } from 'lucide-react';
import type { FleetDriver } from '../types';
import { driverVisual, isDriverOnline, lastSignalAt } from '../lib/status';
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
