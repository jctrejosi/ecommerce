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
  mode?: "multi" | "bundle";
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

export interface CampaignHistoryEntry {
  id: number;
  campaignId: number;
  action: string;
  status: string | null;
  details: {
    name?: string;
    productIds?: number[];
    channels?: string[];
    mode?: string;
    messages?: number;
    recipientsCount?: number;
    scheduledAt?: string;
  } | null;
  createdAt: string;
}

export interface CreateCampaignPayload {
  name: string;
  productId?: number;
  productIds?: number[];
  prompt?: string;
  tone?: string;
  mode?: "multi" | "bundle";
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

export interface Recipient {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
}

export interface GenerateRecipientsResult {
  campaignId: number;
  total: number;
  segment: number | null;
  recipients: { id: number | null; name: string | null; email: string | null; phone: string | null }[];
  note: string;
}

export interface SegmentPreviewRecipient {
  cedula: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  segment?: number;
  propensity?: number | null;
  uplift?: number | null;
  percentile?: number | null;
}

export interface SegmentRankingRow {
  segment: number;
  total: number;
  buyers: number;
  share: number;
  /** Promedios de las features RFM del segmento (perfil de comportamiento). */
  means?: Record<string, number>;
}

export interface SegmentPreviewResult {
  segment: number;
  segmentTotal: number;
  total: number;
  buyers: number;
  mode?: "multi" | "bundle";
  bundleFallback?: boolean;
  note?: string;
  ranking?: SegmentRankingRow[];
  categories?: string[];
  recipients: SegmentPreviewRecipient[];
}

export interface InterpretSegmentPayload {
  mode?: "multi" | "bundle";
  productNames?: string[];
  categories?: string[];
  bestSegment?: number;
  ranking?: SegmentRankingRow[];
  segmentTotal?: number;
  total?: number;
  buyers?: number;
  features?: string[];
  bundleFallback?: boolean;
  note?: string;
  avgPropensity?: number;
  avgUplift?: number;
}

export interface ScoredClient {
  cedula: string;
  segment: number;
  features: {
    frecuencia: number;
    monetario: number;
    ticket_promedio: number;
    categorias_distintas: number;
  };
  propensity: number;
  uplift: number;
  percentile: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  consent_email: boolean;
  consent_whatsapp: boolean;
  consent_sms: boolean;
}

export interface ScoreClientsPayload {
  filters?: {
    segment?: number;
    minFrecuencia?: number;
    maxFrecuencia?: number;
    minMonetario?: number;
    maxMonetario?: number;
    minTicketPromedio?: number;
    maxTicketPromedio?: number;
    minCategoriasDistintas?: number;
    maxCategoriasDistintas?: number;
    ciudades?: string[];
    barrios?: string[];
    direccionContiene?: string;
    minEdad?: number;
    maxEdad?: number;
    sexos?: string[];
    estadosCiviles?: string[];
    minHijos?: number;
    maxHijos?: number;
    profesiones?: string[];
    minValorTotal?: number;
    maxValorTotal?: number;
    minPuntos?: number;
    maxPuntos?: number;
    tieneMascota?: boolean;
    tieneCarro?: boolean;
    esEmpleado?: boolean;
    clubs?: string[];
    consentimientos?: string[];
    sucursales?: string[];
  };
  minPropensity?: number;
  sort?: "propensity" | "uplift" | "segment" | "cedula";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ClientFilterOptions {
  ciudades: string[];
  barrios: string[];
  profesiones: string[];
  estadosCiviles: string[];
  sucursales: string[];
  sexos: string[];
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

  generateRecipients: (
    id: number,
    limit = 500,
    segment?: number,
    modelName?: string,
    mode?: "multi" | "bundle",
    manualCedulas?: string[],
  ) =>
    fetchJson<GenerateRecipientsResult>(`/admin/campaigns/${id}/recipients/generate`, {
      method: "POST",
      body: JSON.stringify({ limit, segment, modelName, mode, manualCedulas }),
    }),

  segmentPreviewStream: (
    productIds: number[],
    opts: {
      onStage?: (s: { message: string; progress: number }) => void;
      onResult?: (r: SegmentPreviewResult) => void;
      onError?: (msg: string) => void;
    },
    mode: "multi" | "bundle" = "multi",
  ) => {
    const es = new EventSource(
      `${API_BASE_URL}/admin/campaigns/segment-preview?productIds=${productIds.join(",")}&limit=100000&mode=${mode}`,
    );
    es.addEventListener("message", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent<string>).data) as
          | { stage: string; message?: string; progress?: number; error?: string; result?: SegmentPreviewResult }
          | undefined;
        if (!d) return;
        if (d.error) {
          opts.onError?.(d.error);
          es.close();
          return;
        }
        if (d.stage && d.stage !== "done" && d.message != null && d.progress != null) {
          opts.onStage?.({ message: d.message, progress: d.progress });
        }
        if (d.result) {
          opts.onResult?.(d.result);
          es.close();
        }
      } catch {
        /* tramas inválidas: se ignoran */
      }
    });
    es.onerror = () => {
      opts.onError?.("No se pudo conectar con el servicio de segmentación");
      es.close();
    };
    return es;
  },

  getRecipients: (id: number) =>
    fetchJson<Recipient[]>(`/admin/campaigns/${id}/recipients`),

  relaunch: (id: number) =>
    fetchJson<Campaign>(`/admin/campaigns/${id}/relaunch`, {
      method: "POST",
    }),

  history: (id: number) =>
    fetchJson<CampaignHistoryEntry[]>(`/admin/campaigns/${id}/history`),

  interpretSegment: (payload: InterpretSegmentPayload) =>
    fetchJson<{ explicacion: string }>("/admin/campaigns/interpret-segment", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  scoreClients: (payload: ScoreClientsPayload) =>
    fetchJson<{ total: number; clients: ScoredClient[] }>("/admin/campaigns/clients/score", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getFilterOptions: () =>
    fetchJson<ClientFilterOptions>("/admin/campaigns/clients/filter-options"),

  addManualRecipients: (id: number, cedulas: string[]) =>
    fetchJson<{ added: number }>(`/admin/campaigns/${id}/recipients/manual`, {
      method: "POST",
      body: JSON.stringify({ cedulas }),
    }),
};
