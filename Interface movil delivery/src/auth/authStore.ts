import { create } from "zustand";
import type { DriverUser } from "@/api/types";
import { api } from "@/api";
import {
  clearTokens,
  getCachedUser,
  getTokens,
  saveCachedUser,
  setTokens,
} from "@/auth/storage";

interface AuthState {
  user: DriverUser | null;
  /** true cuando ya se intentó restaurar la sesión al arrancar. */
  hydrated: boolean;
  isAvailable: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  setUser: (user: DriverUser | null) => void;
  setAvailability: (available: boolean) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  hydrated: false,
  isAvailable: true,
  error: null,

  async login(username, password) {
    set({ error: null });
    try {
      const res = await api.login(username, password);
      // Persistir tokens ANTES de pintar la UI: sin esto, las peticiones
      // autenticadas usarían tokens viejos (o de una sesión mock previa).
      await setTokens(res);
      await saveCachedUser(JSON.stringify(res.user));
      set({ user: res.user, isAvailable: res.user.isAvailable ?? true });
    } catch (err) {
      set({ error: messageFrom(err) });
      throw err;
    }
  },

  async logout() {
    try {
      await api.logout();
    } catch {
      // el backend puede estar caído; la sesión local se limpia igual
    }
    await clearTokens();
    set({ user: null, error: null });
  },

  async restore() {
    try {
      const tokens = await getTokens();
      if (!tokens) {
        set({ hydrated: true });
        return;
      }
      // Cache rápido del usuario para pintar la UI y validar en background.
      const cached = await getCachedUser();
      if (cached) {
        try {
          set({ user: JSON.parse(cached) as DriverUser });
        } catch {
          /* cache corrupta: se ignora */
        }
      }
      const fresh = await api.me();
      await saveCachedUser(JSON.stringify(fresh));
      set({ user: fresh, isAvailable: fresh.isAvailable ?? true });
    } catch {
      await clearTokens();
      set({ user: null });
    } finally {
      set({ hydrated: true });
    }
  },

  setUser(user) {
    set({ user });
  },

  async setAvailability(available) {
    set({ isAvailable: available });
    try {
      const updated = await api.setAvailability(available);
      if (get().user) {
        set({ user: { ...get().user!, ...updated }, isAvailable: updated.isAvailable ?? available });
      }
    } catch {
      // rollback al valor anterior si falla
      set({ isAvailable: !available });
      throw new Error("No se pudo actualizar la disponibilidad");
    }
  },

  clearError() {
    set({ error: null });
  },
}));

export function messageFrom(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "Ocurrió un error inesperado.";
}
