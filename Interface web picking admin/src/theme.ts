/**
 * Temas (presets) del panel de picking.
 *
 * El color vive en variables CSS (`src/index.css`) y aquí solo se decide cuál
 * preset está activo, se aplica con `data-theme` en `<html>` y se recuerda en
 * `localStorage`.
 */

export type ThemePreset = 'amber' | 'blue' | 'violet' | 'light';

export interface ThemeOption {
  id: ThemePreset;
  label: string;
  hint: string;
  /** Color de muestra para el selector. */
  swatch: string;
}

export const THEME_PRESETS: ThemeOption[] = [
  { id: 'amber', label: 'Ámbar', hint: 'Oscuro', swatch: '#FBBF24' },
  { id: 'blue', label: 'Azul', hint: 'Oscuro', swatch: '#3B82F6' },
  { id: 'violet', label: 'Violeta', hint: 'Oscuro', swatch: '#8B5CF6' },
  { id: 'light', label: 'Claro', hint: 'Claro', swatch: '#F4F5F7' },
];

const STORAGE_KEY = 'picking-admin-theme';
const DEFAULT_THEME: ThemePreset = 'amber';

function isPreset(value: string | null | undefined): value is ThemePreset {
  return THEME_PRESETS.some((p) => p.id === value);
}

/** Preset guardado (o el de por defecto si no hay nada válido). */
export function getStoredTheme(): ThemePreset {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isPreset(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Aplica el tema al documento. */
export function applyTheme(id: ThemePreset): void {
  document.documentElement.dataset.theme = id;
}

/** Guarda y aplica el tema elegido. */
export function setStoredTheme(id: ThemePreset): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* localStorage puede no estar disponible; se aplica igual */
  }
  applyTheme(id);
}

/**
 * Aplica el tema guardado antes de montar React, para que no se vea el tema
 * por defecto durante el primer render.
 */
export function initTheme(): ThemePreset {
  const id = getStoredTheme();
  applyTheme(id);
  return id;
}
