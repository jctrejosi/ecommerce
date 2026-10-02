import { useSyncExternalStore } from 'react';

/**
 * Tema visual del panel.
 *
 * - `light`: siempre claro (el de siempre).
 * - `dark`: siempre oscuro.
 * - `system`: sigue la preferencia del sistema operativo.
 *
 * El tema se aplica como `data-theme` en <html> y los colores viven como
 * variables CSS en `index.css` (ver allí el mapa de estilos).
 */
export type Theme = 'light' | 'dark' | 'system';

/** Color de acento del panel (botones primarios, focos y selección). */
export type Accent = 'ambar' | 'azul' | 'verde' | 'violeta' | 'rosa';

const THEME_KEY = 'delivery_admin_theme';
const ACCENT_KEY = 'delivery_admin_accent';

const listeners = new Set<() => void>();

/** Tema guardado; por defecto claro (como el panel de siempre). */
export function getStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* sin localStorage (modo privado) */
  }
  return 'light';
}

/** Acento guardado; por defecto ámbar. */
export function getStoredAccent(): Accent {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    if (raw === 'ambar' || raw === 'azul' || raw === 'verde' || raw === 'violeta' || raw === 'rosa') {
      return raw;
    }
  } catch {
    /* sin localStorage */
  }
  return 'ambar';
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Tema efectivo ('light' | 'dark') según lo elegido y el sistema. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
}

/** Cambia y guarda el tema. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* sin persistencia */
  }
  applyTheme(theme);
  listeners.forEach((fn) => fn());
}

/** Cambia y guarda el acento. */
export function setAccent(accent: Accent): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    /* sin persistencia */
  }
  applyAccent(accent);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hook: [tema elegido, cambiador]. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getStoredTheme);
  return [theme, setTheme];
}

/** Hook: [acento elegido, cambiador]. */
export function useAccent(): [Accent, (a: Accent) => void] {
  const accent = useSyncExternalStore(subscribe, getStoredAccent);
  return [accent, setAccent];
}

/**
 * Aplica el tema y el acento guardados al arrancar y sigue los cambios del
 * sistema cuando el modo elegido es `system`. Devuelve la limpieza del listener.
 */
export function initTheme(): () => void {
  applyTheme(getStoredTheme());
  applyAccent(getStoredAccent());
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  };
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}
