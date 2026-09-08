/** Tema de la app de delivery (paleta azul DSI). */
export const colors = {
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  background: "#F5F7FA",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F1523",
  textMuted: "#64748B",
  textFaint: "#94A3B8",
  success: "#16A34A",
  successBg: "#ECFDF5",
  warning: "#D97706",
  warningBg: "#FFFBEB",
  danger: "#DC2626",
  dangerBg: "#FEF2F2",
  info: "#2563EB",
  infoBg: "#EFF3FF",
  dark: "#0F172A",
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const spacing = (n: number) => n * 4;
