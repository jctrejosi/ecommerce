const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  const data = await response.json().catch(() => ({}));
  if (Array.isArray(data?.message)) return data.message.join(", ");
  return data?.message;
}

/**
 * Cliente HTTP único del panel admin.
 * - Agrega `credentials: "include"` (cookies httpOnly).
 * - Serializa/deserializa JSON.
 * - Normaliza el mensaje de error del backend (string o array) y expone el status.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new ApiError(message || `API error: ${response.status}`, response.status);
  }

  return response.json();
}

export { API_BASE_URL };
