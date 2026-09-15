/** Tiempo relativo corto ("hace 2 min", "hace 3 h", "hace 1 d"). */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'ahora';
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

/**
 * Ventana de presencia: sin señal durante este tiempo, el repartidor se
 * considera desconectado. El heartbeat de la app llega cada minuto, así que
 * tolera varios latidos perdidos antes de marcarlo fuera de línea.
 */
export const PRESENCE_WINDOW_MS = 5 * 60_000;

/** Última señal demasiado vieja ⇒ "sin señal". */
export function isStale(
  iso: string | null | undefined,
  maxAgeMs = PRESENCE_WINDOW_MS,
): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > maxAgeMs;
}

export function formatMoney(value: number, currency = 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function vehicleLabel(d: {
  vehicleType?: string | null;
  vehiclePlate?: string | null;
}): string {
  const parts = [d.vehicleType, d.vehiclePlate].filter(Boolean) as string[];
  return parts.join(' · ') || 'Sin vehículo';
}
