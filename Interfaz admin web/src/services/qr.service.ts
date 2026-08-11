const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export type GenerateQrPayload = {
  text: string;
  format?: "png" | "pdf";
  size?: number;
  errorCorrection?: "L" | "M" | "Q" | "H";
  border?: number;
};

export type SaveQrConfigPayload = {
  fileMediaId?: number | null;
  fileName?: string | null;
  mimeType?: string | null;
  source?: "generated" | "uploaded" | null;
  text?: string | null;
  decoded?: Record<string, unknown> | null;
  generation?: Record<string, unknown> | null;
  enabled?: boolean;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const qrAdminService = {
  status: () => jsonFetch<Record<string, unknown>>(`${API_BASE_URL}/admin/qr/status`),

  generate: (data: GenerateQrPayload) =>
    jsonFetch<{
      format: string;
      media_type: string;
      content_base64: string;
      text: string;
      size: number;
      error_correction: string;
      border: number;
    }>(`${API_BASE_URL}/admin/qr/generate`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  upload: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE_URL}/admin/qr/upload`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Error ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<{
      mediaId: number;
      url: string;
      fileName: string;
      mimeType: string;
      decoded: { items: { text: string; format: string; structure: Record<string, unknown>; page?: number }[]; qr_count: number; source: string; total_pages?: number };
    }>;
  },

  getConfig: () =>
    jsonFetch<Record<string, unknown> | null>(`${API_BASE_URL}/admin/qr/config`),

  saveConfig: (data: SaveQrConfigPayload) =>
    jsonFetch<Record<string, unknown>>(`${API_BASE_URL}/admin/qr/config`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
