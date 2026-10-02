import { useCallback, useEffect, useState } from "react";

/** El cliente sólo alterna entre claro y oscuro; los colores los define el admin. */
export type Theme = "claro" | "oscuro";

export interface ThemeOption {
  id: Theme;
  /** Nombre visible en el selector. */
  label: string;
  /** Los temas oscuros además llevan la clase `.dark` (variante `dark:`). */
  dark?: boolean;
}

export const THEMES: ThemeOption[] = [
  { id: "claro", label: "Claro" },
  { id: "oscuro", label: "Oscuro", dark: true },
];

export const DEFAULT_THEME: Theme = "claro";

/**
 * Tokens de color que el admin puede personalizar (`/contenido/general`).
 * Deben existir en `styles/theme.css`, que actúa de respaldo si la API no
 * responde o no hay personalización.
 */
export const THEME_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--ring",
] as const;

export type ThemePalette = Record<string, string>;
export type ThemeConfig = Partial<Record<Theme, ThemePalette>>;

const STORAGE_KEY = "mercaldas-theme";
const THEME_IDS: string[] = THEMES.map((t) => t.id);

/** Temas retirados: se migran a claro para no dejar una preferencia inválida. */
const LEGACY_THEMES = ["azul", "verde", "rojo", "morado", "light"];

function isTheme(value: string | null): value is Theme {
  return value !== null && THEME_IDS.includes(value);
}

/** Lee la preferencia guardada (migrando los valores antiguos). */
function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "dark") return "oscuro";
    if (value && LEGACY_THEMES.includes(value)) return DEFAULT_THEME;
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

/**
 * Aplica el tema al `<html>`: atributo `data-theme`, clase `.dark`,
 * `color-scheme` y los colores configurados en el admin. Los tokens sin
 * personalización se quitan del estilo inline para volver a `styles/theme.css`.
 */
export function applyTheme(theme: Theme, palette?: ThemeConfig | null) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "oscuro");
  root.style.colorScheme = theme === "oscuro" ? "dark" : "light";

  const values = palette?.[theme];
  for (const token of THEME_TOKENS) {
    const value = values?.[token];
    if (value) root.style.setProperty(token, value);
    else root.style.removeProperty(token);
  }
}

export function useTheme(palette?: ThemeConfig | null) {
  const [theme, setThemeState] = useState<Theme>(
    () => readStoredTheme() ?? (systemPrefersDark() ? "oscuro" : DEFAULT_THEME),
  );

  useEffect(() => {
    applyTheme(theme, palette);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* almacenamiento no disponible: se ignora */
    }
  }, [theme, palette]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "oscuro" ? "claro" : "oscuro")),
    [],
  );

  return { theme, setTheme, toggleTheme };
}
