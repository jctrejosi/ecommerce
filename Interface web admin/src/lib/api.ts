/**
 * URL base del API del panel.
 *
 * El `.env` apunta a `http://localhost:3000`, que solo sirve cuando la página se
 * abre en la misma máquina. Para que el panel funcione también abierto desde el
 * celular con la IP del equipo, cuando el API apunta a loopback (o no está
 * configurado) se usa el host que sirvió la página con el puerto del API: el
 * `localhost` del celular no es la máquina donde corre el backend.
 *
 * Es el mismo criterio que usan los paneles de picking y delivery.
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1)$/;
const DEFAULT_API = "http://localhost:3000";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function portOf(url: string, fallback: string): string {
  try {
    return new URL(url).port || fallback;
  } catch {
    return fallback;
  }
}

export function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL ?? "";
  // Sin `window` (SSR/pruebas) no hay host de página que usar.
  if (typeof window === "undefined") return configured || DEFAULT_API;

  const pageHost = window.location.hostname;
  const configuredHost = hostnameOf(configured);
  const pageIsLoopback = LOOPBACK.test(pageHost);
  const configuredIsLoopback = !configuredHost || LOOPBACK.test(configuredHost);

  if (!pageIsLoopback && configuredIsLoopback) {
    return `${window.location.protocol}//${pageHost}:${portOf(configured, "3000")}`;
  }

  return configured || DEFAULT_API;
}

const API_BASE_URL = resolveApiBaseUrl();

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
