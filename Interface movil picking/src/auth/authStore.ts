import { create } from "zustand";
import { pickingApi } from "@/api";
import {
  clearTokens,
  getStoredUser,
  getTokens,
  setStoredUser,
  setTokens,
  type AuthUser,
} from "./session";

interface AuthState {
  user: AuthUser | null;
  hydrated: boolean;
  restoring: boolean;
  restore: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
}

/**
 * Sesión del picker. La identidad sale de `POST /auth/login` (mismos usuarios
 * que administra el panel de picking), no del selector manual.
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
    set({ user });
  },

  logout: async () => {
    await clearTokens();
    await setStoredUser(null);
    set({ user: null });
  },

  setUser: (user) => set({ user }),
}));
