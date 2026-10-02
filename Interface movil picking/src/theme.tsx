import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

/** Claves de color que expone cada tema. */
export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  card: string;
  chip: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  textHint: string;
  accent: string;
  accentDark: string;
  onAccent: string;
  success: string;
  successText: string;
  info: string;
  infoText: string;
  danger: string;
  dangerText: string;
  warning: string;
  purple: string;
};

export type PresetId = "amber" | "blue" | "violet" | "light";

const amber: Palette = {
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
};

const blue: Palette = {
  ...amber,
  background: "#0A0F1A",
  surface: "#121826",
  surfaceAlt: "#182031",
  accent: "#3B82F6",
  accentDark: "#2563EB",
  onAccent: "#FFFFFF",
};

const violet: Palette = {
  ...amber,
  background: "#0C0A14",
  surface: "#17131F",
  surfaceAlt: "#1E1929",
  accent: "#8B5CF6",
  accentDark: "#7C3AED",
  onAccent: "#FFFFFF",
};

const light: Palette = {
  background: "#F4F5F7",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF0F3",
  card: "rgba(0,0,0,0.03)",
  chip: "rgba(0,0,0,0.04)",
  border: "rgba(0,0,0,0.10)",
  borderStrong: "rgba(0,0,0,0.16)",
  text: "#111827",
  textMuted: "rgba(17,24,39,0.70)",
  textFaint: "rgba(17,24,39,0.50)",
  textHint: "rgba(17,24,39,0.35)",
  accent: "#F59E0B",
  accentDark: "#D97706",
  onAccent: "#1F2937",
  success: "#16A34A",
  successText: "#15803D",
  info: "#2563EB",
  infoText: "#1D4ED8",
  danger: "#DC2626",
  dangerText: "#DC2626",
  warning: "#D97706",
  purple: "#7C3AED",
};

/** Todos los temas disponibles, indexados por id. */
export const PRESETS: Record<PresetId, Palette> = { amber, blue, violet, light };

export const THEME_OPTIONS: { id: PresetId; label: string; hint: string; swatch: string }[] = [
  { id: "amber", label: "Ámbar", hint: "Oscuro", swatch: "#FBBF24" },
  { id: "blue", label: "Azul", hint: "Oscuro", swatch: "#3B82F6" },
  { id: "violet", label: "Violeta", hint: "Oscuro", swatch: "#8B5CF6" },
  { id: "light", label: "Claro", hint: "Claro", swatch: "#F4F5F7" },
];

/** Clave de persistencia del tema elegido. */
const STORAGE_KEY = "picking.theme";

const DEFAULT_PRESET: PresetId = "amber";

const isPresetId = (value: string | null): value is PresetId =>
  value != null && Object.prototype.hasOwnProperty.call(PRESETS, value);

interface ThemeContextValue {
  colors: Palette;
  preset: PresetId;
  setPreset: (id: PresetId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: PRESETS[DEFAULT_PRESET],
  preset: DEFAULT_PRESET,
  setPreset: () => {},
});

/**
 * Provee el tema activo y lo persiste. Al montar hidrata el preset guardado
 * (por defecto ámbar); al cambiarlo lo escribe en AsyncStorage.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preset, setPresetState] = useState<PresetId>(DEFAULT_PRESET);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && isPresetId(stored)) setPresetState(stored);
      } catch {
        /* sin persistencia: se queda con el tema por defecto */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreset = useCallback((id: PresetId) => {
    setPresetState(id);
    void AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {
      /* el cambio de tema sigue vigente en memoria aunque falle el guardado */
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: PRESETS[preset], preset, setPreset }),
    [preset, setPreset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Acceso al tema activo: paleta, preset y su setter. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Crea un hook de estilos a partir de una fábrica que recibe la paleta.
 * El resultado se memoriza por tema, así que cambiar de preset genera una
 * única tanda de estilos y el resto de renders reutilizan la cacheada.
 *
 *   const useStyles = makeStyles((colors) => StyleSheet.create({ ... }));
 *   // dentro del componente:
 *   const styles = useStyles();
 */
export function makeStyles<T>(factory: (colors: Palette) => T): () => T {
  const cache = new Map<PresetId, T>();
  return function useStyles(): T {
    const { colors, preset } = useTheme();
    return useMemo(() => {
      const cached = cache.get(preset);
      if (cached !== undefined) return cached;
      const created = factory(colors);
      cache.set(preset, created);
      return created;
      // `colors` cambia junto con `preset`: cada tema genera su propia entrada.
    }, [colors, preset]);
  };
}

/**
 * Compatibilidad con archivos aún no migrados a la fábrica de estilos: expone
 * la paleta ámbar estática. Los componentes nuevos deben usar `useTheme()` o
 * `makeStyles()` para reaccionar al cambio de tema.
 */
export const colors = PRESETS.amber;
