const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export type BotFunction = {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
};

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const botService = {
  getFunctions: () =>
    fetchJson<{ functions: BotFunction[] }>(`${API_BASE_URL}/admin/bot/functions`),

  updateFunctions: (functions: Record<string, boolean>) =>
    fetchJson<{ functions: BotFunction[] }>(`${API_BASE_URL}/admin/bot/functions`, {
      method: "PUT",
      body: JSON.stringify({ functions }),
    }),
};
