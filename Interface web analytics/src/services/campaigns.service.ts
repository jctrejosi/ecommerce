const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export type CampaignChannel = "whatsapp" | "email" | "sms";
export type CampaignStatus =
  | "borrador"
  | "programada"
  | "enviando"
  | "enviada"
  | "fallida";

export interface CampaignMessage {
  id?: number;
  channel: CampaignChannel;
  subject?: string | null;
  content?: string | null;
  html?: string | null;
  emailBlocks?: unknown;
}

export interface Campaign {
  id: number;
  name: string;
  productId: number | null;
  prompt: string | null;
  tone: string | null;
  channels: CampaignChannel[];
  status: CampaignStatus;
  audienceCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  sentCount: number;
  openedCount: number;
  convertedCount: number;
  createdAt: string;
  updatedAt: string;
  messages: CampaignMessage[];
  product: { id: number; name: string } | null;
  products?: { id: number; name: string }[];
}

export interface CreateCampaignPayload {
  name: string;
  productId?: number;
  productIds?: number[];
  prompt?: string;
  tone?: string;
  channels?: CampaignChannel[];
  scheduledAt?: string;
  messages?: {
    channel: CampaignChannel;
    subject?: string;
    content?: string;
    html?: string;
    emailBlocks?: unknown;
  }[];
}

export interface GenerateContentPayload {
  productId?: number;
  productName?: string;
  price?: number;
  discount?: number;
  products?: { id?: number; name?: string; price?: number }[];
  prompt?: string;
  tone?: string;
  channels: CampaignChannel[];
}

export interface GeneratedEmail {
  asunto: string;
  bloques: { id: string; type: string; props: Record<string, unknown> }[];
  html: string;
}

export interface GeneratedContent {
  whatsapp?: string;
  email?: GeneratedEmail;
  sms?: string;
  error?: string;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${input}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data?.message === "string") message = data.message;
      else if (Array.isArray(data?.message)) message = data.message.join(", ");
    } catch {
      /* noop */
    }
    throw new Error(message);
  }
  return res.json();
}

export const campaignsService = {
  list: (status?: string) =>
    fetchJson<Campaign[]>(`/admin/campaigns${status ? `?status=${status}` : ""}`),

  get: (id: number) => fetchJson<Campaign>(`/admin/campaigns/${id}`),

  create: (payload: CreateCampaignPayload) =>
    fetchJson<Campaign>("/admin/campaigns", { method: "POST", body: JSON.stringify(payload) }),

  update: (id: number, payload: Partial<CreateCampaignPayload>) =>
    fetchJson<Campaign>(`/admin/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  remove: (id: number) =>
    fetchJson<{ success: boolean }>(`/admin/campaigns/${id}`, { method: "DELETE" }),

  generateContent: (payload: GenerateContentPayload) =>
    fetchJson<GeneratedContent>("/admin/campaigns/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  generateRecipients: (id: number, limit = 500) =>
    fetchJson<{ total: number }>(`/admin/campaigns/${id}/recipients/generate`, {
      method: "POST",
      body: JSON.stringify({ limit }),
    }),

  getRecipients: (id: number) =>
    fetchJson<{ id: number; name: string | null; email: string | null; phone: string | null; status: string }[]>(
      `/admin/campaigns/${id}/recipients`,
    ),
};
