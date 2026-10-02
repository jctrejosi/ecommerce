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

const STORAGE_KEY = 'delivery_admin_theme';

const listeners = new Set<() => void>();

/** Tema guardado; por defecto claro (como el panel de siempre). */
export function getStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* sin localStorage (modo privado) */
  }
  return 'light';
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Tema efectivo ('light' | 'dark') según lo elegido y el sistema. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

/** Cambia y guarda el tema. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* sin persistencia */
  }
  apply(theme);
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

/**
 * Aplica el tema guardado al arrancar y sigue los cambios del sistema cuando
 * el modo elegido es `system`. Devuelve la limpieza del listener.
 */
export function initTheme(): () => void {
  apply(getStoredTheme());
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getStoredTheme() === 'system') apply('system');
  };
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}
