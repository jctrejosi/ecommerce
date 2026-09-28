import { useCallback, useEffect, useState } from "react";

export type Theme = "claro" | "azul" | "verde" | "rojo" | "morado" | "oscuro";

export interface ThemeOption {
  id: Theme;
  /** Nombre visible en el selector. */
  label: string;
  /** Color del círculo del selector (es `--primary` del tema). */
  color: string;
  /** Los temas oscuros además llevan la clase `.dark` (variante `dark:`). */
  dark?: boolean;
}

/**
 * Lista de temas disponibles. Cada uno es una paleta completa definida en
 * `styles/theme.css` sobre `<html data-theme="…">`. El `color` es el del
 * círculo que la página quiere mostrar en el selector.
 */
export const THEMES: ThemeOption[] = [
  { id: "claro", label: "Amarillo", color: "var(--primary)" },
  { id: "azul", label: "Azul", color: "#2563EB" },
  { id: "verde", label: "Verde", color: "#16A34A" },
  { id: "rojo", label: "Rojo", color: "#DC2626" },
  { id: "morado", label: "Morado", color: "#7C3AED" },
  { id: "oscuro", label: "Oscuro", color: "#1A1A26", dark: true },
];

export const DEFAULT_THEME: Theme = "claro";

const STORAGE_KEY = "mercaldas-theme";
const THEME_IDS = THEMES.map((t) => t.id) as string[];

function isTheme(value: string | null): value is Theme {
  return value !== null && THEME_IDS.includes(value);
}

/** Lee la preferencia guardada (migrando los valores antiguos claro/oscuro). */
function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light") return "claro";
    if (value === "dark") return "oscuro";
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Aplica el tema al `<html>`: atributo `data-theme` + clase `.dark`. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark = THEMES.find((t) => t.id === theme)?.dark === true;
  root.dataset.theme = theme;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => readStoredTheme() ?? (systemPrefersDark() ? "oscuro" : DEFAULT_THEME),
  );

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* almacenamiento no disponible: se ignora */
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "oscuro" ? "claro" : "oscuro")),
    [],
  );

  return { theme, setTheme, toggleTheme };
}
