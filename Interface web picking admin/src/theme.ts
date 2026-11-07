/**
 * Tema del panel de picking, en dos ejes independientes:
 *   - Color (acento): ámbar · azul · violeta.
 *   - Modo: oscuro · claro · sistema (sigue `prefers-color-scheme` del SO).
 *
 * El color vive en variables CSS (`src/index.css`); aquí solo se decide qué
 * combinación está activa y se aplica con `data-theme` (color) y `data-mode`
 * (claro/oscuro) en `<html>`, recordándola en `localStorage`.
 */

export type ThemeColor = 'amber' | 'blue' | 'violet'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface ThemeColorOption {
  id: ThemeColor
  label: string
  /** Color de muestra para el selector. */
  swatch: string
}

export interface ThemeModeOption {
  id: ThemeMode
  label: string
}

export const THEME_COLORS: ThemeColorOption[] = [
  { id: 'amber', label: 'Ámbar', swatch: '#FBBF24' },
  { id: 'blue', label: 'Azul', swatch: '#3B82F6' },
  { id: 'violet', label: 'Violeta', swatch: '#8B5CF6' },
]

export const THEME_MODES: ThemeModeOption[] = [
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
  { id: 'system', label: 'Sistema' },
]

export interface ThemeState {
  color: ThemeColor
  mode: ThemeMode
}

const STORAGE_KEY = 'picking-admin-theme'
// Por defecto se sigue el tema del sistema operativo (claro u oscuro).
const DEFAULT_THEME: ThemeState = { color: 'amber', mode: 'system' }

const isColor = (v: unknown): v is ThemeColor => THEME_COLORS.some((c) => c.id === v)
const isMode = (v: unknown): v is ThemeMode => THEME_MODES.some((m) => m.id === v)

/** Parsea lo guardado, migrando los valores del esquema anterior (preset único). */
function parseStored(saved: string | null): ThemeState {
  if (!saved) return DEFAULT_THEME
  // Esquema anterior: un único preset por nombre.
  if (saved === 'light') return { color: 'amber', mode: 'light' }
  if (isColor(saved)) return { color: saved, mode: 'dark' }
  // Esquema actual: "color:mode".
  const [color, mode] = saved.split(':')
  if (isColor(color) && isMode(mode)) return { color, mode }
  return DEFAULT_THEME
}

/** Tema guardado (o el de por defecto si no hay nada válido). */
export function getStoredTheme(): ThemeState {
  try {
    return parseStored(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

const SYSTEM_QUERY = '(prefers-color-scheme: dark)'

/**
 * Resuelve el modo efectivo (claro/oscuro). En modo "sistema" consulta la
 * preferencia del SO; el resto son passthrough.
 */
function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  try {
    return window.matchMedia(SYSTEM_QUERY).matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

/**
 * Aplica el tema al documento. La preferencia (incluido "system") se guarda en
 * `localStorage`, pero `data-mode` recibe siempre el modo efectivo, para que el
 * CSS de `[data-mode='light']` funcione igual en los tres casos.
 */
export function applyTheme(state: ThemeState): void {
  document.documentElement.dataset.theme = state.color
  document.documentElement.dataset.mode = resolveMode(state.mode)
}

/**
 * Re-aplica el tema cuando el SO cambia entre claro y oscuro, siempre que el
 * modo activo sea "system". Se registra una sola vez desde `initTheme`.
 */
export function watchSystemMode(): void {
  try {
    window.matchMedia(SYSTEM_QUERY).addEventListener('change', () => {
      const state = getStoredTheme()
      if (state.mode === 'system') applyTheme(state)
    })
  } catch {
    /* matchMedia no disponible; sin seguimiento del SO */
  }
}

/** Guarda y aplica el tema elegido. */
export function setStoredTheme(state: ThemeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, `${state.color}:${state.mode}`)
  } catch {
    /* localStorage puede no estar disponible; se aplica igual */
  }
  applyTheme(state)
}

/**
 * Aplica el tema guardado antes de montar React, para que no se vea el tema
 * por defecto durante el primer render.
 */
export function initTheme(): ThemeState {
  const state = getStoredTheme()
  applyTheme(state)
  watchSystemMode()
  return state
}
