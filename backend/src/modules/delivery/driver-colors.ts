/**
 * Paleta de colores para las rutas de los repartidores en el mapa de flota.
 *
 * Debe coincidir con la del panel web
 * (`Interface web delivery admin/src/lib/driverColors.ts`).
 */
export const DRIVER_COLORS = [
  '#2563EB',
  '#DC2626',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#0891B2',
  '#DB2777',
  '#65A30D',
  '#EA580C',
  '#4F46E5',
  '#0D9488',
  '#B45309',
] as const;

/**
 * Color aleatorio de la paleta evitando los ya usados (si quedan libres).
 * Así cada repartidor nuevo arranca con un color distinto, pero editable.
 */
export function pickRouteColor(used: string[] = []): string {
  const free = DRIVER_COLORS.filter((c) => !used.includes(c));
  const pool = free.length ? free : DRIVER_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}
