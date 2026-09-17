const moneyFmt = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return "$0";
  return moneyFmt.format(n);
}

/**
 * Parsea las marcas de tiempo que devuelve el backend.
 *
 * Postgres las entrega como `2026-09-16 22:27:16.057934+00`: con espacio en vez
 * de "T" y el offset sin minutos. V8 (navegador) lo tolera, pero Hermes no y
 * `new Date(...)` da `Invalid Date`; por eso salían horas como "Invalid Date" y
 * los "hace X min" siempre en 1. Aquí se normaliza a ISO 8601.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Hora corta en español ("3:53 p. m."), o "" si la fecha no es válida. */
export function formatTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";
  return date.toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Minutos transcurridos desde un ISO (mínimo 1). */
export function minutesAgo(iso: string): number {
  const then = parseDate(iso)?.getTime();
  if (then == null) return 1;
  return Math.max(1, Math.floor((Date.now() - then) / 60_000));
}

/** "hace 5 min" / "hace 2h 10m". */
export function formatTimeAgo(minutes: number): string {
  if (minutes < 60) return `hace ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `hace ${h}h` : `hace ${h}h ${m}m`;
}

/** Hash determinista de un texto → tono 0..359 (para placeholders de imagen). */
export function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
