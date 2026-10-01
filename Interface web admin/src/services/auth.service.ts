import { API_BASE_URL, apiFetch as fetchJson, ApiError } from "../lib/api";

export { ApiError as AuthApiError };

export type UserProfile = {
  id: number;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  phone: string | null;
  isSuperuser: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};



export const authService = {
  async getProfile(): Promise<UserProfile> {
    return fetchJson<UserProfile>(`${API_BASE_URL}/auth/me`);
  },

  /**
   * Login con email o username. Las cookies httpOnly las setea el backend.
   */
  async login(identifier: string, password: string): Promise<UserProfile> {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = Array.isArray(data?.message)
        ? data.message.join(", ")
        : data?.message;
      throw new ApiError(message || "Credenciales inválidas", res.status);
    }
    return data.user as UserProfile;
  },

  async logout(): Promise<void> {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  },

  /** Actualiza el perfil del usuario autenticado (nombre, teléfono, email). */
  async updateProfile(data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
  }): Promise<UserProfile> {
    return fetchJson<UserProfile>(`${API_BASE_URL}/auth/me`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  /** Cambia la contraseña del usuario autenticado (exige la actual). */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    return fetchJson<{ success: boolean }>(`${API_BASE_URL}/auth/me/password`, {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
};
