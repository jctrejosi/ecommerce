import { create } from "zustand";
import { pickingApi } from "@/api";
import {
  clearSessionMeta,
  clearTokens,
  getSessionMeta,
  getStoredUser,
  getTokens,
  setSessionMeta,
  setStoredUser,
  setTokens,
  type AuthUser,
  type SessionMeta,
} from "./session";

/** Inactividad máxima sin acción antes de cerrar la sesión (2 horas). */
const INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000;

interface AuthState {
  user: AuthUser | null;
  hydrated: boolean;
  restoring: boolean;
  restore: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  /** Marca actividad (llamado por cada respuesta del API) para el vencimiento. */
  touchActivity: () => void;
  /** Revisa vencimiento por fin de turno o inactividad y cierra la sesión si toca. */
  checkExpiry: () => Promise<void>;
}

/** Calcula el fin del turno de hoy a partir de "HH:MM" (hora del dispositivo). */
function shiftEndFrom(closeTime: string | null): number | null {
  if (!closeTime) return null;
  const [h, m] = closeTime.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const end = new Date();
  end.setHours(h, m, 0, 0);
  return end.getTime();
}

/** Minutos que faltan para el fin del turno (para loguear). */
export function minutesUntilShiftEnd(shiftEndAt: number | null): number | null {
  if (!shiftEndAt) return null;
  return Math.max(0, Math.round((shiftEndAt - Date.now()) / 60000));
}

let lastTouchWrite = 0;

/**
 * Sesión del picker. La identidad sale de `POST /auth/login` (mismos usuarios
 * que administra el panel de picking). La sesión se guarda entre arranques,
 * pero vence al final del turno (horario de sucursales) o por inactividad.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  restoring: false,

  restore: async () => {
    set({ restoring: true });
    try {
      const tokens = await getTokens();
      const stored = await getStoredUser();
      if (!tokens?.accessToken) {
        set({ user: null });
        return;
      }

      // Si la sesión ya venció (turno o inactividad), se pide contraseña.
      const meta = await getSessionMeta();
      const now = Date.now();
      const expired =
        meta !== null &&
        ((meta.shiftEndAt !== null && now > meta.shiftEndAt) ||
          now - meta.lastActivityAt > INACTIVITY_LIMIT_MS);
      if (expired) {
        await clearTokens();
        await clearSessionMeta();
        set({ user: null });
        return;
      }

      if (stored) set({ user: stored });
      // Valida el token contra el backend (si expiró, el interceptor limpia).
      try {
        const me = await pickingApi.me();
        const user: AuthUser = {
          id: me.id,
          name: me.fullName || me.username,
          username: me.username,
          email: me.email,
          isSuperuser: me.isSuperuser,
        };
        set({ user });
        await setStoredUser(user);
        // Refresca el fin de turno (pudo cambiar el horario).
        const shiftEndAt = await pickingApi
          .shiftToday()
          .then((s) => shiftEndFrom(s.closeTime))
          .catch(() => null);
        await setSessionMeta({
          loginAt: meta?.loginAt ?? now,
          lastActivityAt: now,
          shiftEndAt: shiftEndAt ?? meta?.shiftEndAt ?? null,
        });
      } catch {
        // Si /auth/me falla por red, conservamos el usuario guardado.
      }
    } finally {
      set({ hydrated: true, restoring: false });
    }
  },

  login: async (identifier, password) => {
    const res = await pickingApi.login(identifier, password);
    await setTokens({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
    });
    const u = res.user;
    const user: AuthUser = {
      id: u.id,
      name: u.fullName || u.username || u.email,
      username: u.username,
      email: u.email,
      isSuperuser: u.isSuperuser,
    };
    await setStoredUser(user);

    // Inicia la ventana de sesión: fin del turno de hoy + actividad ahora.
    const now = Date.now();
    const shiftEndAt = await pickingApi
      .shiftToday()
      .then((s) => shiftEndFrom(s.closeTime))
      .catch(() => null);
    const meta: SessionMeta = { loginAt: now, lastActivityAt: now, shiftEndAt };
    await setSessionMeta(meta);

    set({ user });
  },

  logout: async () => {
    await clearTokens();
    await clearSessionMeta();
    await setStoredUser(null);
    set({ user: null });
  },

  setUser: (user) => set({ user }),

  touchActivity: () => {
    const now = Date.now();
    // Evita escribir a disco en cada petición (máx. 1 vez por minuto).
    if (now - lastTouchWrite < 60_000) return;
    lastTouchWrite = now;
    void getSessionMeta().then(async (meta) => {
      if (!meta) return;
      await setSessionMeta({ ...meta, lastActivityAt: now });
    });
  },

  checkExpiry: async () => {
    const { user } = useAuthStore.getState();
    if (!user) return;
    const meta = await getSessionMeta();
    if (!meta) return;
    const now = Date.now();
    const expired =
      (meta.shiftEndAt !== null && now > meta.shiftEndAt) ||
      now - meta.lastActivityAt > INACTIVITY_LIMIT_MS;
    if (expired) {
      await useAuthStore.getState().logout();
    }
  },
}));
