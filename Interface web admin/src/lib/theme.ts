/**
 * Tema del panel admin: modo (claro/oscuro) y color de acento.
 *
 * El panel está construido con Tailwind v4, que compila las clases de color a
 * `var(--color-*)` (p. ej. `bg-amber-400` → `background-color: var(--color-amber-400)`).
 * Por eso el tema se implementa reasignando esas variables CSS desde
 * `index.css` según los atributos `data-mode` y `data-accent` del `<html>`,
 * sin tener que tocar los componentes.
 */
import { useEffect, useState } from "react";

export type ThemeMode = "claro" | "oscuro";

export type ThemeAccent =
  | "ambar"
  | "esmeralda"
  | "azul"
  | "violeta"
  | "rosa"
  | "teal";

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "claro", label: "Claro" },
  { id: "oscuro", label: "Oscuro" },
];

export const THEME_ACCENTS: {
  id: ThemeAccent;
  label: string;
  /** Color de muestra para el botón del selector (tono 400 de la paleta). */
  swatch: string;
}[] = [
  { id: "ambar", label: "Ámbar", swatch: "#fbbf24" },
  { id: "esmeralda", label: "Esmeralda", swatch: "#34d399" },
  { id: "azul", label: "Azul", swatch: "#60a5fa" },
  { id: "violeta", label: "Violeta", swatch: "#a78bfa" },
  { id: "rosa", label: "Rosa", swatch: "#fb7185" },
  { id: "teal", label: "Teal", swatch: "#2dd4bf" },
];

export const DEFAULT_MODE: ThemeMode = "claro";
export const DEFAULT_ACCENT: ThemeAccent = "ambar";

const MODE_KEY = "mercaldas-admin-mode";
const ACCENT_KEY = "mercaldas-admin-accent";

const MODE_IDS = THEME_MODES.map((m) => m.id);
const ACCENT_IDS = THEME_ACCENTS.map((a) => a.id);

export function loadThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return MODE_IDS.includes(v as ThemeMode) ? (v as ThemeMode) : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function loadThemeAccent(): ThemeAccent {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return ACCENT_IDS.includes(v as ThemeAccent)
      ? (v as ThemeAccent)
      : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Escribe el tema en el `<html>` para que el CSS lo aplique. */
export function applyTheme(mode: ThemeMode, accent: ThemeAccent): void {
  const root = document.documentElement;
  root.dataset.mode = mode;
  root.dataset.accent = accent;
}

export function saveTheme(mode: ThemeMode, accent: ThemeAccent): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    /* localStorage no disponible: el tema solo dura la sesión. */
  }
}

/**
 * Hook de tema: mantiene el estado y lo aplica/persiste en cada cambio.
 * El valor inicial viene de `localStorage` (ya aplicado antes del pintado por
 * el script inline de `index.html`).
 */
export function useTheme(): {
  mode: ThemeMode;
  accent: ThemeAccent;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);
  const [accent, setAccentState] = useState<ThemeAccent>(loadThemeAccent);

  useEffect(() => {
    applyTheme(mode, accent);
    saveTheme(mode, accent);
  }, [mode, accent]);

  return {
    mode,
    accent,
    setMode: setModeState,
    setAccent: setAccentState,
  };
}
