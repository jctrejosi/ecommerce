const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export class AuthApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

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

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = Array.isArray(data?.message)
      ? data.message.join(", ")
      : data?.message;
    throw new AuthApiError(
      message || `API error: ${response.status}`,
      response.status,
    );
  }
  return response.json();
}

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
      throw new AuthApiError(message || "Credenciales inválidas", res.status);
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
};
