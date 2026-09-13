/** Tema oscuro del picking (misma paleta que la web de picking). */
export const colors = {
  background: "#0C0C0D",
  surface: "#161618",
  surfaceAlt: "#1C1C1E",
  card: "rgba(255,255,255,0.04)",
  chip: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.16)",

  text: "#FFFFFF",
  textMuted: "rgba(255,255,255,0.70)",
  textFaint: "rgba(255,255,255,0.45)",
  textHint: "rgba(255,255,255,0.30)",

  accent: "#FBBF24",
  accentDark: "#F59E0B",
  onAccent: "#0C0C0D",

  success: "#22C55E",
  successText: "#4ADE80",
  info: "#3B82F6",
  infoText: "#60A5FA",
  danger: "#EF4444",
  dangerText: "#F87171",
  warning: "#F59E0B",
  purple: "#8B5CF6",
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const spacing = (n: number) => n * 4;

/** Paleta de colores para estanterías (igual que el admin de picking). */
export const CATEGORY_COLORS = [
  "#3B82F6",
  "#EF4444",
  "#22C55E",
  "#F59E0B",
  "#A855F7",
  "#06B6D4",
  "#F97316",
  "#EC4899",
  "#10B981",
  "#6B7280",
] as const;
