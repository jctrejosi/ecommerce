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

/** Minutos transcurridos desde un ISO (mínimo 1). */
export function minutesAgo(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 1;
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
