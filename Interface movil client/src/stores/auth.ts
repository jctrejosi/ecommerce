import { create } from "zustand";
import type { Customer } from "../api/types";
import { authApi } from "../api/auth";

interface AuthState {
  customer: Customer | null;
  loading: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
    acceptsTerms: boolean;
  }) => Promise<void>;
  socialLogin: (
    provider: "google" | "facebook",
    accessToken: string,
    userData?: { email?: string; name?: string; picture?: string; id?: string },
  ) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  customer: null,
  loading: true,

  init: async () => {
    try {
      const customer = await authApi.getProfile();
      set({ customer, loading: false });
    } catch {
      set({ customer: null, loading: false });
    }
  },

  login: async (email, password) => {
    const res = await authApi.login({ email, password });
    set({ customer: res.customer });
  },

  register: async (data) => {
    const res = await authApi.register(data);
    set({ customer: res.customer });
  },

  socialLogin: async (provider, accessToken, userData) => {
    const res = await authApi.socialLogin(provider, accessToken, userData);
    set({ customer: res.customer });
  },

  logout: async () => {
    await authApi.logout();
    set({ customer: null });
  },
}));
