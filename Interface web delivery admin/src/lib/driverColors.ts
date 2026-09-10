/**
 * Paleta de colores para las rutas de los repartidores en el mapa de flota.
 *
 * Debe coincidir con la del backend
 * (`backend/src/modules/delivery/driver-colors.ts`).
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
 * Color del repartidor: el configurado, o uno estable de la paleta según su id
 * (para repartidores antiguos sin color guardado).
 */
export function driverColor(driver: {
  id: number;
  routeColor?: string | null;
}): string {
  if (driver.routeColor) return driver.routeColor;
  return DRIVER_COLORS[Math.abs(driver.id) % DRIVER_COLORS.length];
}
