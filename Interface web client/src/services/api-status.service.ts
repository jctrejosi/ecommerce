const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const apiStatusService = {
  async waitUntilReady(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api-status`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Backend no disponible");
    }
  },

  /** Devuelve true si el backend responde correctamente (sin lanzar). */
  async checkStatus(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/api-status`, {
        credentials: "include",
        cache: "no-store", // evita respuestas cacheadas en el chequeo
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
