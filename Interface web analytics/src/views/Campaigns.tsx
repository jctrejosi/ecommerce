import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus, Search, MessageCircle, Mail, Smartphone, Zap,
  ArrowRight, ChevronLeft, ChevronDown, RefreshCw, Send, Clock,
  CheckCircle, Users, TrendingUp, Eye, Edit3, X,
  Sparkles, Target, BarChart2, Calendar, MoreHorizontal,
  Palette, ShoppingBag, Pencil, Trash2, History, RotateCw,
  Filter, CheckSquare, SlidersHorizontal, MapPin, Wallet, ShieldCheck,
  PawPrint,
} from "lucide-react";
import EmailEditor, {
  newBlock,
  defaultTemplate,
  type EmailBlock,
} from "../components/EmailEditor";
import {
  campaignsService,
  type Campaign as ApiCampaign,
  type CampaignChannel,
  type CampaignHistoryEntry,
  type Recipient,
  type SegmentPreviewResult,
  type SegmentRankingRow,
  type ScoredClient,
  type ScoreClientsPayload,
  type ClientFilterOptions,
} from "../services/campaigns.service";
import { catalogService, type CatalogProduct, type CatalogCategory } from "../services/catalog.service";

/* ─── Types ─────────────────────────────────────── */
/** Producto del catálogo real (alias del tipo del servicio de catálogo). */
type Product = CatalogProduct;

interface GeneratedContent {
  whatsapp: string; email: { subject: string; body: string }; sms: string;
}

type CampaignStatus = "borrador" | "programada" | "enviando" | "enviada" | "fallida";
type Step = 1 | 2 | 3;

/* ─── Placeholders de segmentación ──────────────── */
// La segmentación inteligente de clientes aún no está conectada;
// mientras tanto usamos estimaciones fijas para los paneles del wizard.
const ESTIMATED_AUDIENCE = 500;
const ESTIMATED_CONV_RATE = 3;

const STATUS_CFG: Record<CampaignStatus, { label: string; color: string; bg: string; border: string }> = {
  borrador:   { label: "Borrador",   color: "text-gray-600",  bg: "bg-gray-100",   border: "border-gray-200" },
  programada: { label: "Programada", color: "text-blue-700",  bg: "bg-blue-50",    border: "border-blue-200" },
  enviando:   { label: "Enviando",   color: "text-amber-700", bg: "bg-amber-50",   border: "border-amber-200" },
  enviada:    { label: "Enviada",    color: "text-green-700", bg: "bg-green-50",   border: "border-green-200" },
  fallida:    { label: "Fallida",    color: "text-red-700",   bg: "bg-red-50",     border: "border-red-200" },
};

const CHANNEL_CFG = {
  wa:    { label: "WhatsApp", bg: "bg-green-500",  icon: MessageCircle },
  email: { label: "Email",    bg: "bg-blue-500",   icon: Mail },
  sms:   { label: "SMS",      bg: "bg-purple-500", icon: Smartphone },
};

/** Claves del wizard (wa/email/sms) ↔ canales de la API (whatsapp/email/sms). */
const CHANNEL_TO_API: Record<keyof typeof CHANNEL_CFG, CampaignChannel> = {
  wa: "whatsapp",
  email: "email",
  sms: "sms",
};

const CHANNEL_FROM_API: Record<CampaignChannel, keyof typeof CHANNEL_CFG> = {
  whatsapp: "wa",
  email: "email",
  sms: "sms",
};

/** Forma de la tarjeta de campaña (lo que consume CampaignCard). */
interface CampaignCardData {
  id: number;
  name: string;
  product: string;
  channels: (keyof typeof CHANNEL_CFG)[];
  audience: number;
  status: CampaignStatus;
  sent: number;
  opens: number;
  conversions: number;
  date: string;
}

function apiToCard(c: ApiCampaign): CampaignCardData {
  return {
    id: c.id,
    name: c.name,
    product:
      c.products?.length
        ? c.products.map((p) => p.name).join(", ")
        : c.product?.name ?? "Sin producto",
    channels: c.channels
      .map((ch) => CHANNEL_FROM_API[ch])
      .filter(Boolean),
    audience: c.audienceCount,
    status: c.status,
    sent: c.sentCount,
    opens: c.openedCount,
    conversions: c.convertedCount,
    date: (c.scheduledAt ?? c.createdAt ?? "").slice(0, 10),
  };
}

/** Extrae un texto plano de los bloques del correo (para el preview). */
function blocksToText(bloques: { type: string; props: Record<string, unknown> }[]): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const partes: string[] = [];
  for (const b of bloques ?? []) {
    const p = b.props ?? {};
    if (b.type === "text" && typeof p.text === "string") {
      const t = strip(p.text);
      if (t) partes.push(t);
    } else if (b.type === "columns" && Array.isArray(p.items)) {
      for (const it of p.items as { text?: string }[]) {
        if (typeof it.text === "string" && it.text.trim()) partes.push(strip(it.text));
      }
    }
  }
  return partes.join("\n");
}

/* ─── Helpers ───────────────────────────────────── */
function fmt(n: number) { return "$" + n.toLocaleString("es-CO"); }

/** Convierte el contenido generado en bloques para el diseñador de correo. */
function buildEmailBlocks(product: Product, content: GeneratedContent): EmailBlock[] {
  const bodyHtml = content.email.body
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 8px;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return [
    { ...newBlock("text"), props: { text: "🛒 Mercaldas", fontSize: 24, color: "#B45309", align: "center", bold: true } },
    { ...newBlock("image"), props: { src: product.image ?? undefined, alt: product.name, width: 100, borderRadius: 12, borderWidth: 0, shadow: true } },
    { ...newBlock("text"), props: { text: bodyHtml, fontSize: 15, color: "#1F2937", align: "left" } },
    { ...newBlock("button"), props: { text: "Ver oferta →", link: "https://mercaldas.com/promo", bg: "#FBBF24", color: "#78350F", radius: 10, align: "center" } },
    newBlock("divider"),
    newBlock("social"),
    { ...newBlock("text"), props: { text: "El equipo de Mercaldas 💛<br/>Si no quieres recibir más correos, haz clic aquí.", fontSize: 12, color: "#9CA3AF", align: "center" } },
  ];
}

/* ─── Channel preview components ───────────────── */
function WhatsAppPreview({ text, editable, onEdit }: { text: string; editable: boolean; onEdit: (t: string) => void }) {
  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden shadow-lg" style={{ background: "#ECE5DD" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: "#075E54" }}>
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <MessageCircle size={16} className="text-white" />
        </div>
        <div>
          <p className="text-white text-sm font-semibold leading-tight">Mercaldas</p>
          <p className="text-white/70 text-[10px]">en línea</p>
        </div>
      </div>
      {/* Body */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm p-3 shadow-sm" style={{ background: "#DCF8C6" }}>
          {editable ? (
            <textarea
              value={text}
              onChange={(e) => onEdit(e.target.value)}
              className="w-full text-xs text-gray-800 bg-transparent resize-none focus:outline-none leading-relaxed"
              rows={10}
            />
          ) : (
            <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">{text}</p>
          )}
          <p className="text-right text-[10px] text-gray-500 mt-1">12:00 ✓✓</p>
        </div>
      </div>
    </div>
  );
}

function EmailHtmlPreview({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState({ w: 600, h: 800 });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const s = Math.min(rect.width / content.w, rect.height / content.h);
      setScale(Math.min(s, 1));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden bg-gray-50">
      <iframe
        srcDoc={html}
        title="Vista previa del correo"
        sandbox="allow-same-origin"
        scrolling="no"
        onLoad={(e) => {
          const frame = e.currentTarget as HTMLIFrameElement;
          try {
            const de = frame.contentDocument?.documentElement;
            if (de) {
              setContent({
                w: Math.max(de.scrollWidth, 600),
                h: Math.max(de.scrollHeight, 800),
              });
            }
          } catch {
            /* si no es accesible, queda con el tamaño por defecto */
          }
        }}
        style={{
          width: content.w,
          height: content.h,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: 0,
          display: "block",
          background: "#fff",
        }}
      />
    </div>
  );
}

function EmailPreview({ subject, body, editableBody, onEditSubject, onEditBody, html }: {
  subject: string; body: string; editableBody: boolean;
  onEditSubject: (s: string) => void; onEditBody: (b: string) => void;
  html?: string | null;
}) {
  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden shadow-lg border border-gray-200 bg-white">
      {/* Fake browser bar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 border-b border-gray-200">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <p className="ml-3 text-[10px] text-gray-400">Gmail — Bandeja de entrada</p>
      </div>
      {/* Email header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-white">M</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-800">Mercaldas <span className="text-gray-400 font-normal">noreply@mercaldas.com</span></p>
          </div>
        </div>
        <input
          value={subject}
          onChange={(e) => onEditSubject(e.target.value)}
          className="text-xs font-bold text-gray-900 w-full focus:outline-none focus:bg-gray-50 rounded px-1 -mx-1"
        />
      </div>
      {/* Email body */}
      <div className="flex-1 overflow-hidden">
        {html ? (
          <EmailHtmlPreview html={html} />
        ) : (
          <div className="h-full overflow-y-auto">
            {/* Fake banner */}
            <div className="h-16 bg-gradient-to-r from-amber-400 to-amber-500 flex items-center justify-center">
              <p className="text-amber-900 font-bold text-sm">🛒 Mercaldas</p>
            </div>
            <div className="px-4 py-3">
              {editableBody ? (
                <textarea
                  value={body}
                  onChange={(e) => onEditBody(e.target.value)}
                  className="w-full text-xs text-gray-700 leading-relaxed bg-transparent resize-none focus:outline-none focus:bg-gray-50 rounded"
                  rows={12}
                />
              ) : (
                <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{body}</p>
              )}
              <button className="mt-3 w-full py-2 text-xs font-bold bg-amber-400 text-amber-900 rounded-xl">
                Ver oferta →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SmsPreview({ text, editable, onEdit }: { text: string; editable: boolean; onEdit: (t: string) => void }) {
  const chars = text.length;
  const overLimit = chars > 160;
  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden shadow-lg border border-gray-200" style={{ background: "#F2F2F7" }}>
      {/* Header */}
      <div className="flex items-center justify-center px-4 py-3 bg-white border-b border-gray-200">
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-900">Mercaldas</p>
          <p className="text-[10px] text-gray-400">Mensaje de texto</p>
        </div>
      </div>
      {/* Body */}
      <div className="flex-1 p-4">
        <div className="max-w-[80%] rounded-2xl rounded-tl-sm p-3 bg-gray-300 shadow-sm">
          {editable ? (
            <textarea
              value={text}
              onChange={(e) => onEdit(e.target.value)}
              className={`w-full text-xs bg-transparent resize-none focus:outline-none leading-relaxed ${overLimit ? "text-red-600" : "text-gray-800"}`}
              rows={5}
            />
          ) : (
            <p className={`text-xs whitespace-pre-wrap leading-relaxed ${overLimit ? "text-red-600" : "text-gray-800"}`}>{text}</p>
          )}
        </div>
        <div className={`mt-2 text-right text-[10px] font-semibold ${overLimit ? "text-red-500" : "text-gray-400"}`}>
          {chars}/160 {overLimit && "⚠ supera el límite"}
        </div>
      </div>
    </div>
  );
}

/* ─── Step components ───────────────────────────── */
function Step1({
  selectedProducts, onToggle, onClear, channels, onToggleChannel, onNext,
  mode, onModeChange,
}: {
  selectedProducts: Product[];
  onToggle: (p: Product) => void;
  onClear: () => void;
  channels: Record<string, boolean>;
  onToggleChannel: (c: string) => void;
  onNext: () => void;
  mode: "multi" | "bundle";
  onModeChange: (m: "multi" | "bundle") => void;
}) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [activeCats, setActiveCats] = useState<number[]>([]);
  const [showSelected, setShowSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      catalogService.getProducts({ limit: 200, isActive: true }),
      catalogService.getCategories(),
    ])
      .then(([list, cats]) => {
        if (cancelled) return;
        setProducts(list);
        setCategories(cats);
      })
      .catch((e) => {
        if (!cancelled)
          setLoadError(
            e instanceof Error ? e.message : "No se pudieron cargar los productos",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCat = (id: number) =>
    setActiveCats((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const q = search.trim().toLowerCase();
  const catNames = new Set(
    categories.filter((c) => activeCats.includes(c.id)).map((c) => c.name),
  );
  const filtered = products.filter((p) => {
    if (activeCats.length) {
      const byId = p.categoryId != null && activeCats.includes(p.categoryId);
      const byName = catNames.has(p.category ?? "");
      if (!byId && !byName) return false;
    }
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q) ||
      (p.brandName ?? "").toLowerCase().includes(q) ||
      (p.productTypeName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">¿Qué producto(s) quieres promocionar?</h2>
              <p className="text-sm text-gray-500 mt-1">Puedes seleccionar varios productos para una misma campaña.</p>
            </div>
            {selectedProducts.length > 0 && (
              <button
                onClick={() => setShowSelected(true)}
                className="shrink-0 flex items-center gap-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold px-3 py-2 rounded-full transition-colors"
              >
                <ShoppingBag size={13} />
                Ver seleccionados ({selectedProducts.length})
              </button>
            )}
          </div>

          <div className="relative mb-5">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto por nombre o categoría..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
            />
          </div>

          {categories.length > 0 && (
            <div className="mb-5">
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                <button
                  onClick={() => setActiveCats([])}
                  className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${activeCats.length === 0 ? "bg-amber-400 text-amber-900 border-transparent" : "bg-white border-gray-200 text-gray-600 hover:border-amber-300"}`}
                >
                  Todas
                </button>
                {categories.map((c) => {
                  const on = activeCats.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCat(c.id)}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${on ? "bg-amber-400 text-amber-900 border-transparent" : "bg-white border-gray-200 text-gray-600 hover:border-amber-300"}`}
                    >
                      {c.name}
                      {c.count > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${on ? "bg-amber-900/15 text-amber-900" : "bg-gray-100 text-gray-400"}`}>
                          {c.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl border-2 border-gray-100 p-4 animate-pulse">
                  <div className="w-14 h-14 rounded-xl bg-gray-100 mb-3" />
                  <div className="h-3 bg-gray-100 rounded mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              ))
            ) : loadError ? (
              <div className="col-span-full bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
                <p className="text-sm font-semibold text-red-700 mb-1">No se pudieron cargar los productos</p>
                <p className="text-xs text-red-500">{loadError}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="col-span-full bg-gray-50 border border-gray-100 rounded-2xl p-8 text-center">
                <p className="text-sm text-gray-500">
                  No hay productos que coincidan con los filtros aplicados.
                </p>
              </div>
            ) : (
              filtered.map((p) => {
                const active = selectedProducts.some((s) => s.id === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => onToggle(p)}
                    className={`relative text-left rounded-2xl border-2 p-4 transition-all hover:shadow-md ${active ? "border-amber-400 bg-amber-50 shadow-md" : "border-gray-100 bg-white hover:border-gray-200"}`}
                  >
                    {active && (
                      <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                        <CheckCircle size={12} className="text-white" />
                      </div>
                    )}
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 mb-3 flex items-center justify-center">
                      {p.image ? (
                        <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl">🛒</span>
                      )}
                    </div>
                    <p className={`text-sm font-semibold leading-tight mb-1 ${active ? "text-amber-900" : "text-gray-800"}`}>{p.name}</p>
                    <p className="text-xs text-gray-400 mb-2">{fmt(p.price)}</p>
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded-lg w-fit max-w-full">
                      <Target size={9} className="shrink-0" />
                      <span className="truncate">
                        {p.category || "General"}
                        {p.brandName ? ` · ${p.brandName}` : ""}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Canales de envío */}
          <div className="mt-5 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                <Users size={15} className="text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Canales de envío</p>
                <p className="text-xs text-gray-400">Elige por dónde enviar la campaña</p>
              </div>
            </div>
            <div className="flex gap-2">
              {(Object.entries(CHANNEL_CFG) as [string, typeof CHANNEL_CFG[keyof typeof CHANNEL_CFG]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => onToggleChannel(key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${channels[key] ? `${cfg.bg} text-white border-transparent` : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
                >
                  <cfg.icon size={13} />
                  {cfg.label}
                </button>
              ))}
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mt-4">
              <p className="text-xs font-semibold text-gray-700 mb-2">¿Cómo se agrupan los clientes?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onModeChange("multi")}
                  className={`flex-1 px-3 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${mode === "multi" ? "bg-amber-400 text-amber-900 border-transparent shadow-sm" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
                >
                  🏷️ Descuento (independientes)
                </button>
                <button
                  onClick={() => onModeChange("bundle")}
                  className={`flex-1 px-3 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${mode === "bundle" ? "bg-amber-400 text-amber-900 border-transparent shadow-sm" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
                >
                  🧩 Combo (van juntos)
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                {mode === "bundle"
                  ? "Segmenta clientes que compraron los productos juntos en la misma factura."
                  : "Segmenta clientes que compraron cualquiera de los productos (o sus categorías)."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white flex justify-end">
        <button
          onClick={onNext}
          disabled={selectedProducts.length === 0 || !Object.values(channels).some(Boolean)}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continuar <ArrowRight size={15} />
        </button>
      </div>

      {/* Modal: productos seleccionados */}
      {showSelected && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowSelected(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <p className="font-bold text-gray-900 text-sm">
                Productos seleccionados ({selectedProducts.length})
              </p>
              <button
                onClick={() => setShowSelected(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {selectedProducts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Aún no has seleccionado productos.
                </p>
              ) : (
                selectedProducts.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl p-2.5">
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-200 flex items-center justify-center shrink-0">
                      {p.image ? (
                        <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-base">🛒</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {[p.category, p.brandName].filter(Boolean).join(" · ") || "Catálogo Mercaldas"} · {fmt(p.price)}
                      </p>
                    </div>
                    <button
                      onClick={() => onToggle(p)}
                      className="w-7 h-7 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center shrink-0 transition-colors"
                      title="Quitar"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 shrink-0">
              <button
                onClick={() => {
                  onClear();
                  setShowSelected(false);
                }}
                className="text-xs font-semibold text-red-600 hover:text-red-700 transition-colors"
              >
                Limpiar todo
              </button>
              <button
                onClick={() => setShowSelected(false)}
                className="px-4 py-2 text-xs font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-xl transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Switch de canal: permite deshabilitar un módulo sin perder su contenido. */
function ChannelSwitch({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      title={active ? "Desactivar este canal" : "Activar este canal"}
      className={`relative rounded-full transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-300 ${
        active ? "bg-green-500" : "bg-gray-300"
      }`}
      style={{ width: 36, height: 20 }}
    >
      <span
        className="absolute top-0.5 bg-white rounded-full shadow transition-transform"
        style={{ width: 16, height: 16, left: 2, transform: active ? "translateX(16px)" : "none" }}
      />
    </button>
  );
}

function Step2({
  products,
  channels,
  prompt,
  setPrompt,
  generating,
  generated,
  content,
  editableWa,
  editableEmail,
  editableSms,
  onGenerate,
  onEditWa,
  onEditEmailSubject,
  onEditEmailBody,
  onEditSms,
  onToggleEdit,
  onOpenDesigner,
  emailHtml,
  genError,
  onNext,
  onBack,
  onToggleChannel,
}: {
  products: Product[];
  channels: Record<string, boolean>;
  prompt: string;
  setPrompt: (s: string) => void;
  generating: boolean;
  generated: boolean;
  content: GeneratedContent | null;
  editableWa: boolean;
  editableEmail: boolean;
  editableSms: boolean;
  onGenerate: () => void;
  onEditWa: (t: string) => void;
  onEditEmailSubject: (s: string) => void;
  onEditEmailBody: (b: string) => void;
  onEditSms: (t: string) => void;
  onToggleEdit: (ch: "wa" | "email" | "sms") => void;
  onOpenDesigner: () => void;
  emailHtml: string | null;
  genError: string | null;
  onNext: () => void;
  onBack: () => void;
  onToggleChannel: (c: string) => void;
}) {
  const activeChannelCount = Object.values(channels).filter(Boolean).length;

  // Módulos visibles: los activos + los desactivados que conservan contenido
  // (para poder reactivarlos con su switch sin perder el preview).
  const renderedModules = (["wa", "email", "sms"] as const).filter(
    (k) =>
      channels[k] ||
      (content &&
        (k === "wa"
          ? !!content.whatsapp
          : k === "email"
            ? !!(content.email.subject || content.email.body)
            : !!content.sms)),
  ).length;
  const gridCls =
    renderedModules === 3
      ? "grid-cols-3"
      : renderedModules === 2
        ? "grid-cols-2"
        : "grid-cols-1 max-w-sm mx-auto";

  // Mientras la IA genera, se oculta el resto y solo se muestra este aviso.
  if (generating) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-10 text-center">
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full border-4 border-amber-200 animate-ping" />
          <div className="w-20 h-20 rounded-full bg-amber-400 flex items-center justify-center">
            <Sparkles size={28} className="text-white" />
          </div>
        </div>
        <p className="mt-6 text-lg font-bold text-gray-900">La IA está creando tu campaña…</p>
        <p className="mt-2 text-sm text-gray-500">Analizando tono, público y canal</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {!generated ? (
          <div className="p-6 max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Describe tu campaña</h2>
            <p className="text-sm text-gray-500 mb-6">La IA generará los mensajes para <strong>{activeChannelCount} canal{activeChannelCount !== 1 ? "es" : ""}</strong> automáticamente.</p>

            {/* Products reminder */}
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-white shrink-0 flex items-center justify-center">
                  {products[0]?.image ? (
                    <img src={products[0].image} alt={products[0].name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">🛒</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-amber-900 truncate">
                    {products.length === 1 ? products[0].name : `${products.length} productos seleccionados`}
                  </p>
                  <p className="text-xs text-amber-700 truncate">
                    {products.map((p) => p.name).join(", ")}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {products.map((p) => (
                  <span key={p.id} className="text-[10px] font-semibold bg-white/70 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-full truncate max-w-50">
                    {fmt(p.price)} · {p.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">¿De qué trata la promoción?</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Ej: lanza un descuento por lanzamiento con un tono joven y urgente, enfocado en familias jóvenes de Medellín..."
                className="w-full px-4 py-3 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none placeholder-gray-300"
              />
            </div>

            {genError && (
              <div className="mb-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                ⚠ {genError}
              </div>
            )}
            <button
              onClick={onGenerate}
              disabled={!prompt.trim()}
              className="w-full flex items-center justify-center gap-3 py-3.5 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-2xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
            >
              <Sparkles size={16} />
              Generar Campaña
            </button>
          </div>
        ) : (
          /* Generated previews */
          <div className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                <CheckCircle size={14} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">¡Campaña generada! Revisa y edita si quieres.</p>
                <p className="text-xs text-gray-400">Haz clic en <strong>Editar</strong> en cualquier canal para modificar el texto.</p>
              </div>
              <button
                onClick={onGenerate}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 transition-colors shrink-0"
              >
                <RefreshCw size={12} /> Regenerar
              </button>
            </div>

            <div className={`grid gap-4 ${gridCls}`}>
              {(channels.wa || content?.whatsapp) && (
                <div className={`flex flex-col ${!channels.wa ? "opacity-45" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-green-500 flex items-center justify-center">
                        <MessageCircle size={12} className="text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-700">WhatsApp</span>
                      {!channels.wa && (
                        <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full uppercase">Deshabilitado</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {channels.wa && (
                        <button onClick={() => onToggleEdit("wa")} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${editableWa ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                          <Edit3 size={9} /> {editableWa ? "Listo" : "Editar"}
                        </button>
                      )}
                      <ChannelSwitch active={!!channels.wa} onToggle={() => onToggleChannel("wa")} />
                    </div>
                  </div>
                  <div className="flex-1 h-80">
                    {content?.whatsapp ? (
                      <WhatsAppPreview text={content.whatsapp} editable={editableWa} onEdit={onEditWa} />
                    ) : (
                      <div className="h-full flex items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 px-4 text-center">
                        No generado para este canal
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(channels.email || content?.email.subject || content?.email.body) && (
                <div className={`flex flex-col ${!channels.email ? "opacity-45" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-blue-500 flex items-center justify-center">
                        <Mail size={12} className="text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-700">Email</span>
                      {!channels.email && (
                        <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full uppercase">Deshabilitado</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {channels.email && (
                        <>
                          <button onClick={onOpenDesigner} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">
                            <Palette size={9} /> Diseñar
                          </button>
                          <button onClick={() => onToggleEdit("email")} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${editableEmail ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                            <Edit3 size={9} /> {editableEmail ? "Listo" : "Editar"}
                          </button>
                        </>
                      )}
                      <ChannelSwitch active={!!channels.email} onToggle={() => onToggleChannel("email")} />
                    </div>
                  </div>
                  <div className="flex-1 h-80">
                    {content?.email.subject || content?.email.body ? (
                      <EmailPreview
                        subject={content.email.subject}
                        body={content.email.body}
                        editableBody={editableEmail}
                        onEditSubject={onEditEmailSubject}
                        onEditBody={onEditEmailBody}
                        html={emailHtml}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 px-4 text-center">
                        No generado para este canal
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(channels.sms || content?.sms) && (
                <div className={`flex flex-col ${!channels.sms ? "opacity-45" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-purple-500 flex items-center justify-center">
                        <Smartphone size={12} className="text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-700">SMS</span>
                      {!channels.sms && (
                        <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full uppercase">Deshabilitado</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {channels.sms && (
                        <button onClick={() => onToggleEdit("sms")} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${editableSms ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                          <Edit3 size={9} /> {editableSms ? "Listo" : "Editar"}
                        </button>
                      )}
                      <ChannelSwitch active={!!channels.sms} onToggle={() => onToggleChannel("sms")} />
                    </div>
                  </div>
                  <div className="flex-1 h-80">
                    {content?.sms ? (
                      <SmsPreview text={content.sms} editable={editableSms} onEdit={onEditSms} />
                    ) : (
                      <div className="h-full flex items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 px-4 text-center">
                        No generado para este canal
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ChevronLeft size={15} /> Atrás
        </button>
        {generated && (
          <button onClick={onNext} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-xl transition-all">
            Revisar y programar <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function Step3({
  products,
  channels,
  onSend,
  onBack,
  sent,
  sending,
  sendError,
  mode,
}: {
  products: Product[];
  channels: Record<string, boolean>;
  onSend: () => void;
  onBack: () => void;
  sent: boolean;
  sending: boolean;
  sendError: string | null;
  mode: "multi" | "bundle";
}) {
  const [scheduled, setScheduled] = useState(false);
  const activeChannels = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);

  // Previsualización de la segmentación (analytics / clustering-api) vía SSE:
  // corre al entrar al paso, muestra el progreso por etapas y el resultado.
  const [seg, setSeg] = useState<SegmentPreviewResult | null>(null);
  const [segLoading, setSegLoading] = useState(true);
  const [segStage, setSegStage] = useState<{ message: string; progress: number }>({
    message: "Analizando el comportamiento de compra de los clientes…",
    progress: 3,
  });
  const [segError, setSegError] = useState<string | null>(null);
  const [clientsOpen, setClientsOpen] = useState(false);

  useEffect(() => {
    const ids = products.map((p) => p.id).filter((x): x is number => x != null);
    if (!ids.length) {
      setSegError("La campaña no tiene productos seleccionados");
      setSegLoading(false);
      return;
    }
    setSegLoading(true);
    setSegError(null);
    setSegStage({ message: "Conectando con el servicio de segmentación…", progress: 2 });
    const es = campaignsService.segmentPreviewStream(
      ids,
      {
        onStage: (s) => setSegStage(s),
        onResult: (r) => {
          setSeg(r);
          setSegLoading(false);
        },
        onError: (msg) => {
          setSegError(msg);
          setSegLoading(false);
        },
      },
      mode,
    );
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalReach = seg?.total ?? ESTIMATED_AUDIENCE;
  // Universo total de clientes analizado (suma de todos los segmentos).
  const totalPool = (seg?.ranking ?? []).reduce((a, r) => a + r.total, 0);
  // Público objetivo real: clientes con ≥70% de probabilidad de compra (tras el filtro).
  const audience = seg?.total ?? totalReach;

  const scored = (seg?.recipients ?? []).filter((r) => r.propensity != null);
  const uplifted = (seg?.recipients ?? []).filter((r) => r.uplift != null);
  const explainCtx: ExplainContext | null = seg
    ? {
        mode: seg.mode ?? "multi",
        productNames: products.map((p) => p.name),
        categories: seg.categories ?? [],
        ranking: seg.ranking ?? [],
        bestSegment: seg.segment,
        segmentTotal: seg.segmentTotal,
        total: seg.total,
        buyers: seg.buyers,
        note: seg.note,
        bundleFallback: seg.bundleFallback,
        avgPropensity: scored.length
          ? scored.reduce((a, r) => a + (r.propensity ?? 0), 0) / scored.length
          : null,
        avgUplift: uplifted.length
          ? uplifted.reduce((a, r) => a + (r.uplift ?? 0), 0) / uplifted.length
          : null,
      }
    : null;

  if (sent) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
        <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-6 animate-bounce">
          <CheckCircle size={44} className="text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Campaña lanzada! 🎉</h2>
        <p className="text-gray-500 mb-1">
          <strong className="text-gray-800">{audience.toLocaleString()} mensajes</strong> están en cola de envío.
        </p>
        <p className="text-sm text-gray-400 mb-8">
          Canales: {activeChannels.map((c) => CHANNEL_CFG[c as keyof typeof CHANNEL_CFG].label).join(", ")}
        </p>
        <div className="grid grid-cols-3 gap-4 w-full max-w-sm">
          {[
            { label: "Estimados abiertos", value: Math.round(audience * 0.6).toLocaleString() },
            { label: "Conversiones est.", value: Math.round(audience * ESTIMATED_CONV_RATE / 100).toLocaleString() },
            { label: "ROI esperado", value: `${(ESTIMATED_CONV_RATE * 4.2).toFixed(0)}%` },
          ].map((s) => (
            <div key={s.label} className="bg-gray-50 rounded-2xl p-4 text-center">
              <p className="text-lg font-bold text-gray-900">{s.value}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Revisa tu campaña</h2>
          <p className="text-sm text-gray-500 mb-6">Todo listo. Confirma los detalles y decide cuándo enviar.</p>

          {/* Summary card */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Resumen</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                  {products[0]?.image ? (
                    <img src={products[0].image} alt={products[0].name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-base">🛒</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {products.length === 1 ? products[0].name : `${products.length} productos`}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {products.map((p) => p.name).join(", ")}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-sm text-gray-600">Público objetivo</span>
                <div className="flex items-center gap-2.5">
                  {segLoading ? (
                    <span className="text-sm text-gray-400">segmentando…</span>
                  ) : segError ? (
                    <span className="text-sm font-bold text-red-600">—</span>
                  ) : (
                    <span className="text-sm font-bold text-gray-900">
                      {seg
                        ? `Seleccionados ${seg.total.toLocaleString()} clientes${totalPool > 0 ? ` de ${totalPool.toLocaleString()} en total` : ""}`
                        : `${totalReach.toLocaleString()} clientes`}
                    </span>
                  )}
                  <button
                    onClick={() => setClientsOpen(true)}
                    disabled={!seg || seg.recipients.length === 0}
                    className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Ver qué clientes cumplen el estándar"
                  >
                    <Users size={13} /> Ver clientes
                  </button>
                </div>
              </div>
              {segError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ⚠ No se pudo ejecutar la segmentación: {segError}
                </p>
              )}
              {seg && !segError && (
                <div className="space-y-1">
                  <p className="text-[11px] text-gray-400">
                    {seg.mode === "bundle" ? "🧩 Combo (van juntos)" : "🏷️ Descuento (independientes)"} · Segmento {seg.segment} · {seg.buyers.toLocaleString()} clientes con afinidad a los productos
                  </p>
                  {seg.note && <p className="text-[11px] text-gray-500">{seg.note}</p>}
                  {seg.bundleFallback && (
                    <p className="text-[11px] text-amber-600">⚠ La co-compra de estos productos es casi nula; se usaron sus categorías como respaldo.</p>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-sm text-gray-600">Canales</span>
                <div className="flex gap-1.5">
                  {activeChannels.map((c) => {
                    const cfg = CHANNEL_CFG[c as keyof typeof CHANNEL_CFG];
                    return (
                      <span key={c} className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full ${cfg.bg}`}>
                        {cfg.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-sm text-gray-600">Conversiones estimadas</span>
                <span className="text-sm font-bold text-green-600">~{Math.round(audience * ESTIMATED_CONV_RATE / 100)}</span>
              </div>
            </div>
          </div>

          {clientsOpen && seg && (
            <RecipientsModal
              title="Clientes segmentados"
              subtitle={`Seleccionados ${seg.total.toLocaleString()} clientes${totalPool > 0 ? ` de ${totalPool.toLocaleString()} en total` : ""}`}
              recipients={seg.recipients}
              explain={explainCtx}
              onClose={() => setClientsOpen(false)}
            />
          )}

          {/* Schedule option */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-800">¿Cuándo enviar?</p>
              <div className="flex items-center bg-gray-100 rounded-xl p-1">
                <button onClick={() => setScheduled(false)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${!scheduled ? "bg-white shadow-sm text-gray-800" : "text-gray-500"}`}>Ahora</button>
                <button onClick={() => setScheduled(true)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${scheduled ? "bg-white shadow-sm text-gray-800" : "text-gray-500"}`}>Programar</button>
              </div>
            </div>
            {scheduled ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Fecha</label>
                  <input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Hora</label>
                  <input type="time" defaultValue="09:00" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300" />
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">La campaña se enviará inmediatamente al confirmar.</p>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ChevronLeft size={15} /> Atrás
        </button>
        {sendError && (
          <p className="flex-1 mx-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
            ⚠ {sendError}
          </p>
        )}
        <button
          onClick={onSend}
          disabled={sending}
          className="flex items-center gap-2.5 px-6 py-3 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={15} /> {sending ? "Creando campaña…" : scheduled ? "Programar Campaña" : "Enviar Ahora"}
        </button>
      </div>

      {/* ── Pantalla de carga de la segmentación ── */}
      {segLoading && (
        <div className="fixed inset-0 z-60 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-400 flex items-center justify-center shadow-lg animate-pulse">
            <RefreshCw size={28} className="text-amber-900 animate-spin" />
          </div>
          <h3 className="mt-6 text-lg font-bold text-gray-900 text-center">Trabajando en la segmentación…</h3>
          <p className="mt-2 text-sm text-gray-500 text-center max-w-sm">{segStage.message}</p>
          <div className="mt-6 w-64 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(segStage.progress, 99)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400 font-semibold">{Math.round(segStage.progress)}%</p>
        </div>
      )}
    </div>
  );
}

/* ─── Step progress bar ─────────────────────────── */
function StepBar({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Seleccionar Producto" },
    { n: 2, label: "Generar Campaña" },
    { n: 3, label: "Revisar y Enviar" },
  ];
  return (
    <div className="flex items-center gap-0 px-8 py-4 border-b border-gray-100 bg-white shrink-0">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1 last:flex-none">
          <div className="flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step > s.n ? "bg-green-500 text-white" : step === s.n ? "bg-amber-400 text-amber-900" : "bg-gray-200 text-gray-500"}`}>
              {step > s.n ? <CheckCircle size={14} /> : s.n}
            </div>
            <span className={`text-xs font-semibold ${step === s.n ? "text-gray-900" : "text-gray-400"}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-4 ${step > s.n ? "bg-green-400" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Wizard overlay ────────────────────────────── */
function CampaignWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CampaignCardData) => void }) {
  const [step, setStep] = useState<Step>(1);
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
  const [channels, setChannels] = useState<Record<string, boolean>>({ wa: true, email: true, sms: true });
  const [mode, setMode] = useState<"multi" | "bundle">("multi");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [editableWa, setEditableWa] = useState(false);
  const [editableEmail, setEditableEmail] = useState(false);
  const [editableSms, setEditableSms] = useState(false);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emailDesignOpen, setEmailDesignOpen] = useState(false);
  const [emailBlocks, setEmailBlocks] = useState<EmailBlock[] | null>(null);
  const [emailHtml, setEmailHtml] = useState<string | null>(null);

  const toggleChannel = (c: string) =>
    setChannels((prev) => {
      // Nunca desactivar el último canal activo (mínimo uno siempre).
      if (prev[c] && Object.values(prev).filter(Boolean).length === 1) return prev;
      return { ...prev, [c]: !prev[c] };
    });

  const toggleProduct = (p: Product) =>
    setSelectedProducts((prev) =>
      prev.some((s) => s.id === p.id)
        ? prev.filter((s) => s.id !== p.id)
        : [...prev, p],
    );

  const activeChannelKeys = () =>
    (Object.keys(channels) as (keyof typeof CHANNEL_CFG)[]).filter((k) => channels[k]);

  const handleGenerate = async () => {
    if (!selectedProducts.length) return;
    const primary = selectedProducts[0];
    setGenerating(true);
    setGenerated(false);
    setGenError(null);
    try {
      const res = await campaignsService.generateContent({
        productId: primary.id,
        productName: primary.name,
        price: primary.price,
        products: selectedProducts.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
        })),
        prompt,
        channels: activeChannelKeys().map((k) => CHANNEL_TO_API[k]),
      });
      if (res.error) throw new Error(res.error);

      const email = res.email;
      // Conserva el contenido de canales desactivados al regenerar: solo se
      // sobreescribe lo que la IA devolvió para los canales activos.
      setContent((c) => ({
        whatsapp: res.whatsapp ?? c?.whatsapp ?? "",
        email: {
          subject: email?.asunto ?? c?.email?.subject ?? "",
          body: email?.bloques?.length ? blocksToText(email.bloques) : c?.email?.body ?? "",
        },
        sms: res.sms ?? c?.sms ?? "",
      }));
      if (email?.bloques?.length) {
        setEmailBlocks(email.bloques as unknown as EmailBlock[]);
        setEmailHtml(email.html ?? null);
      }
      setGenerated(true);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Error generando el contenido");
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!selectedProducts.length || !content) return;
    const primary = selectedProducts[0];
    setSending(true);
    setSendError(null);
    try {
      const active = activeChannelKeys();
      const messages: {
        channel: CampaignChannel;
        subject?: string;
        content?: string;
        html?: string;
        emailBlocks?: unknown;
      }[] = [];
      if (channels.wa && content.whatsapp) {
        messages.push({ channel: "whatsapp", content: content.whatsapp });
      }
      if (channels.email) {
        messages.push({
          channel: "email",
          subject: content.email.subject,
          content: content.email.body,
          html: emailHtml ?? undefined,
          emailBlocks: emailBlocks ?? undefined,
        });
      }
      if (channels.sms && content.sms) {
        messages.push({ channel: "sms", content: content.sms });
      }

      const created = await campaignsService.create({
        name:
          prompt.slice(0, 60) ||
          `Campaña ${primary.name}${selectedProducts.length > 1 ? ` +${selectedProducts.length - 1}` : ""}`,
        productId: primary.id,
        productIds: selectedProducts.map((p) => p.id),
        prompt,
        mode,
        channels: active.map((k) => CHANNEL_TO_API[k]),
        messages,
      });

      // Recomendación de clientes (segmentación vía clustering-api según el modo).
      const gen = await campaignsService.generateRecipients(created.id, 100000, undefined, undefined, mode).catch(() => null);

      setSent(true);
      const card = apiToCard(created);
      if (gen) card.audience = gen.total;
      onCreated(card);
      setTimeout(onClose, 1800);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Error creando la campaña");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-400 flex items-center justify-center">
            <Zap size={15} className="text-amber-900" />
          </div>
          <p className="font-bold text-gray-900 text-sm">Nueva Campaña Omnicanal</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
          <X size={16} />
        </button>
      </div>

      <StepBar step={step} />

      <div className="flex-1 overflow-hidden flex flex-col">
        {step === 1 && (
          <Step1
            selectedProducts={selectedProducts}
            onToggle={toggleProduct}
            onClear={() => setSelectedProducts([])}
            channels={channels}
            onToggleChannel={toggleChannel}
            onNext={() => setStep(2)}
            mode={mode}
            onModeChange={setMode}
          />
        )}
        {step === 2 && selectedProducts.length > 0 && (
          <Step2
            products={selectedProducts}
            channels={channels}
            prompt={prompt}
            setPrompt={setPrompt}
            generating={generating}
            generated={generated}
            content={content}
            editableWa={editableWa}
            editableEmail={editableEmail}
            editableSms={editableSms}
            onGenerate={handleGenerate}
            onEditWa={(t) => setContent((c) => c ? { ...c, whatsapp: t } : c)}
            onEditEmailSubject={(s) => setContent((c) => c ? { ...c, email: { ...c.email, subject: s } } : c)}
            onEditEmailBody={(b) => setContent((c) => c ? { ...c, email: { ...c.email, body: b } } : c)}
            onEditSms={(t) => setContent((c) => c ? { ...c, sms: t } : c)}
            onToggleEdit={(ch) => {
              if (ch === "wa") setEditableWa((e) => !e);
              if (ch === "email") setEditableEmail((e) => !e);
              if (ch === "sms") setEditableSms((e) => !e);
            }}
            onOpenDesigner={() => setEmailDesignOpen(true)}
            emailHtml={emailHtml}
            genError={genError}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
            onToggleChannel={toggleChannel}
          />
        )}
        {step === 3 && selectedProducts.length > 0 && (
          <Step3
            products={selectedProducts}
            channels={channels}
            onSend={handleSend}
            onBack={() => setStep(2)}
            sent={sent}
            sending={sending}
            sendError={sendError}
            mode={mode}
          />
        )}
      </div>

      {/* Diseñador de correo (drag & drop) */}
      {emailDesignOpen && (
        <EmailEditor
          initialBlocks={
            emailBlocks ??
            (selectedProducts.length > 0 && content
              ? buildEmailBlocks(selectedProducts[0], content)
              : defaultTemplate())
          }
          onSave={(blocks, html) => {
            setEmailBlocks(blocks);
            setEmailHtml(html);
            setContent((c) =>
              c ? { ...c, email: { ...c.email, body: blocksToText(blocks) } } : c,
            );
            setEmailDesignOpen(false);
          }}
          onClose={() => setEmailDesignOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── Modal de clientes segmentados ──────────────── */
type SegClientRow = {
  id: number | string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status?: string;
  segment?: number;
  propensity?: number | null;
  uplift?: number | null;
  percentile?: number | null;
};

function scoreColor(p: number): string {
  if (p >= 0.8) return "bg-green-100 text-green-700";
  if (p >= 0.6) return "bg-amber-100 text-amber-700";
  return "bg-gray-100 text-gray-600";
}

/** Formatea un promedio: enteros con separador de miles; decimales si es < 100. */
const fmt1 = (v: number) => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));
/** Formatea un monto promedio en unidades (sin decimales). */
const fmtMoney = (v: number) => Math.round(v).toLocaleString();

type ExplainContext = {
  mode?: "multi" | "bundle";
  productNames: string[];
  categories: string[];
  ranking: SegmentRankingRow[];
  bestSegment: number;
  segmentTotal: number;
  total: number;
  buyers: number;
  note?: string;
  bundleFallback?: boolean;
  avgPropensity?: number | null;
  avgUplift?: number | null;
};

const EXPLAIN_FEATURES = [
  { key: "frecuencia", label: "Frecuencia de compra" },
  { key: "monetario", label: "Monetario (gasto total)" },
  { key: "ticket_promedio", label: "Ticket promedio" },
  { key: "categorias_distintas", label: "Categorías distintas" },
];

/** Renderiza texto plano convirtiendo **negrita** en <strong> (sin HTML crudo). */
function renderBold(text: string) {
  return text.split("**").map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-bold text-gray-900">{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ExplainModal({ ctx, onClose }: { ctx: ExplainContext; onClose: () => void }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await campaignsService.interpretSegment({
        mode: ctx.mode,
        productNames: ctx.productNames,
        categories: ctx.categories,
        bestSegment: ctx.bestSegment,
        ranking: ctx.ranking,
        segmentTotal: ctx.segmentTotal,
        total: ctx.total,
        buyers: ctx.buyers,
        features: EXPLAIN_FEATURES.map((f) => f.key),
        bundleFallback: ctx.bundleFallback,
        note: ctx.note,
        avgPropensity: ctx.avgPropensity ?? undefined,
        avgUplift: ctx.avgUplift ?? undefined,
      });
      setExplanation(res.explicacion);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo interpretar la segmentación");
    } finally {
      setLoading(false);
    }
  };

  // Genera la interpretación con IA automáticamente al abrir el modal.
  useEffect(() => {
    void explain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = [...ctx.ranking].sort((a, b) => b.share - a.share);
  const totalPool = ctx.ranking.reduce((a, r) => a + r.total, 0);
  const bestRow = ctx.ranking.find((r) => r.segment === ctx.bestSegment);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-400 text-white flex items-center justify-center text-sm font-black shrink-0 shadow-sm">?</span>
              ¿Cómo se escogieron los clientes?
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">El paso a paso de cómo se eligió este público</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Cómo se seleccionaron los clientes */}
          <section>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Cómo se seleccionaron los clientes</h4>
            <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
              <p>
                La segmentación se realiza en varias etapas. Cada etapa reduce la base de clientes hasta identificar
                aquellos con mayor potencial para la campaña.
              </p>

              <div>
                <p className="font-bold text-gray-900">1. Identificación de tipos de clientes</p>
                <p className="mt-1">
                  Primero se analiza el comportamiento histórico de compra de cada cliente: qué tan frecuentemente compra,
                  cuánto gasta, cuánto suele gastar por compra y qué tan variadas son sus compras.
                </p>
                <p className="mt-1">
                  Con esta información, el sistema <strong>agrupa automáticamente a los clientes que tienen comportamientos similares</strong>.
                  Se generan 6 grupos diferentes. Por ejemplo, un grupo puede estar compuesto principalmente por clientes
                  frecuentes y de alto gasto, mientras otro puede reunir clientes ocasionales y de menor gasto.
                </p>
                <blockquote className="mt-2 border-l-2 border-amber-300 pl-3 text-xs text-gray-500 italic">
                  En esta etapa no se definen manualmente reglas como "si compra más de 10 veces pertenece al grupo A".
                  El sistema identifica los grupos a partir de las similitudes encontradas entre los clientes.
                </blockquote>
              </div>

              <div>
                <p className="font-bold text-gray-900">2. Identificación del grupo más relacionado con la campaña</p>
                <p className="mt-1">Después se analiza cuáles de esos grupos tienen mayor afinidad con los productos que queremos promocionar:</p>
                <ul className="mt-1 list-disc list-inside">
                  {ctx.productNames.map((n) => <li key={n}>{n}</li>)}
                </ul>
                <p className="mt-2">Para cada grupo se calcula qué proporción de sus clientes ya compró productos de esas categorías:</p>
                {sorted.length ? (
                  <div className="mt-2 rounded-xl border border-gray-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50">
                          <th className="text-left px-3 py-2">Segmento</th>
                          <th className="text-right px-3 py-2">Clientes</th>
                          <th className="text-right px-3 py-2">% que compraron</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sorted.map((r) => {
                          const best = r.segment === ctx.bestSegment;
                          return (
                            <tr key={r.segment} className={best ? "bg-amber-50" : ""}>
                              <td className="px-3 py-2">
                                <span className="font-bold whitespace-nowrap">
                                  {best ? "⭐ " : ""}Segmento {r.segment}
                                  {best && (
                                    <span className="ml-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">elegido</span>
                                  )}
                                </span>
                                {r.means &&
                                  (r.means.frecuencia != null || r.means.monetario != null || r.means.ticket_promedio != null || r.means.categorias_distintas != null) && (
                                    <div className="flex flex-wrap gap-x-2 mt-0.5 text-[10px] font-medium text-gray-500">
                                      {r.means.frecuencia != null && <span>frec {fmt1(r.means.frecuencia)}</span>}
                                      {r.means.monetario != null && <span>gasto {fmtMoney(r.means.monetario)}</span>}
                                      {r.means.ticket_promedio != null && <span>ticket {fmtMoney(r.means.ticket_promedio)}</span>}
                                      {r.means.categorias_distintas != null && <span>{fmt1(r.means.categorias_distintas)} cat.</span>}
                                    </div>
                                  )}
                              </td>
                              <td className="px-3 py-2 text-right">{r.total.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right font-semibold">{(r.share * 100).toFixed(0)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {bestRow && (
                  <p className="mt-2">
                    En esta segmentación, el <strong>segmento {ctx.bestSegment}</strong> presenta la mayor concentración de
                    compradores ({(bestRow.share * 100).toFixed(1)}% de sus {ctx.segmentTotal.toLocaleString()} clientes) y, por
                    tanto, es el grupo con mayor afinidad histórica con la campaña.
                  </p>
                )}
              </div>

              <div>
                <p className="font-bold text-gray-900">3. Priorización según probabilidad de compra</p>
                <p className="mt-1">Una vez identificado el grupo de mayor interés, se analiza individualmente a sus clientes.</p>
                <p className="mt-1">
                  El modelo estima, para cada cliente, <strong>qué tan probable es que compre los productos de la campaña</strong>.
                </p>
                <p className="mt-1">
                  Así, en lugar de tratar a todos los clientes del segmento por igual, podemos priorizar aquellos con mayor
                  probabilidad de compra.
                </p>
                <p className="mt-1">
                  Para esta campaña, el criterio es seleccionar <strong>solo clientes con 70% o más de probabilidad de compra</strong>,
                  ordenados de mayor a menor score.
                </p>
              </div>

              <div>
                <p className="font-bold text-gray-900">4. Identificación de quién puede ser influenciado por la campaña</p>
                <p className="mt-1">
                  Finalmente, se estima algo diferente: <strong>si enviar la campaña realmente puede cambiar la decisión del cliente</strong>.
                </p>
                <p className="mt-1">El modelo compara dos escenarios:</p>
                <ul className="list-disc list-inside">
                  <li>qué probabilidad tendría de comprar <strong>si recibe la campaña</strong>;</li>
                  <li>qué probabilidad tendría de comprar <strong>si no la recibe</strong>.</li>
                </ul>
                <p className="mt-1">La diferencia entre ambos escenarios indica el potencial de la campaña para influir en ese cliente.</p>
                <div className="mt-2 space-y-1.5 text-xs">
                  <p className="bg-gray-50 rounded-lg px-3 py-2">
                    Cliente A: 70% de probabilidad con campaña vs. 30% sin campaña →{" "}
                    <strong className="text-green-700">alta oportunidad de persuasión</strong>.
                  </p>
                  <p className="bg-gray-50 rounded-lg px-3 py-2">
                    Cliente B: 95% con campaña vs. 93% sin campaña →{" "}
                    <strong className="text-gray-500">baja oportunidad de persuasión</strong>, porque probablemente compraría de todas formas.
                  </p>
                </div>
                <p className="mt-2">
                  De esta manera, la segmentación no se limita a buscar clientes que compran mucho. Busca identificar{" "}
                  <strong>
                    qué tipo de clientes son más afines al producto, cuáles tienen mayor probabilidad de comprar y,
                    especialmente, en cuáles la campaña puede generar un cambio real en su comportamiento
                  </strong>.
                </p>
              </div>

              {/* Resumen numérico de esta segmentación */}
              <div className="mt-1 space-y-1 rounded-xl bg-gray-50 p-3 text-[11px] text-gray-500">
                <p>
                  👥 Se analizaron <strong className="text-gray-700">{totalPool.toLocaleString()}</strong> clientes en total.
                </p>
                <p>
                  🎯 <strong className="text-gray-700">{ctx.buyers.toLocaleString()} clientes</strong> en toda la base compraron productos de las categorías relacionadas.
                </p>
                {ctx.avgPropensity != null && (
                  <p>
                    📈 <strong className="text-gray-700">Propensión promedio {(ctx.avgPropensity * 100).toFixed(1)}%</strong>: probabilidad estimada de que compren si ven la campaña.
                  </p>
                )}
                {ctx.avgUplift != null && (
                  <p>
                    ⚡ <strong className="text-gray-700">Uplift promedio {ctx.avgUplift >= 0 ? "+" : ""}{ctx.avgUplift.toFixed(3)}</strong>: cuánto aumenta la probabilidad de compra si reciben la campaña.{" "}
                    {ctx.avgUplift < 0
                      ? "Negativo: no son muy persuasibles, comprarían igual aunque no reciban la campaña."
                      : "Positivo: la campaña puede inclinar su decisión de compra."}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Interpretación IA */}
          <section>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Interpretación con IA</h4>
            {loading || (!explanation && !error) ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
                <RefreshCw size={14} className="animate-spin" /> Generando interpretación…
              </div>
            ) : error ? (
              <div className="flex flex-col items-start gap-2">
                <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">⚠ {error}</div>
                <button
                  onClick={() => void explain()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors"
                >
                  <RefreshCw size={12} /> Reintentar
                </button>
              </div>
            ) : explanation ? (
              <div>
                <div className="text-sm text-gray-700 bg-gray-50 rounded-xl p-4 leading-relaxed">
                  {explanation.split("\n\n").map((p, i) => (
                    <p key={i} className={i > 0 ? "mt-2" : ""}>{renderBold(p)}</p>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setExplanation(null);
                    void explain();
                  }}
                  className="mt-2 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ↻ Regenerar explicación
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function RecipientsModal({
  title,
  subtitle,
  recipients: preset,
  campaignId,
  explain,
  onManualSeg,
  onClose,
}: {
  title: string;
  subtitle?: string;
  recipients?: {
    name: string | null;
    email: string | null;
    phone: string | null;
    segment?: number;
    propensity?: number | null;
    uplift?: number | null;
    percentile?: number | null;
  }[];
  campaignId?: number;
  explain?: ExplainContext | null;
  onManualSeg?: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"seg" | "all">("seg");

  // Filtros manuales del tab "Todos los clientes" (perfil + RFM).
  const f = useManualFilters();
  const filtersRef = useRef<NonNullable<ScoreClientsPayload["filters"]>>({});
  filtersRef.current = f.buildFilters();
  const loadedFiltersRef = useRef<string>("");
  const [filterModalOpen, setFilterModalOpen] = useState(false);

  // ── Pestaña "Segmentados" (recomendados / destinatarios) ──
  const [recipients, setRecipients] = useState<SegClientRow[]>([]);
  const [loading, setLoading] = useState(campaignId != null && preset == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [explainOpen, setExplainOpen] = useState(false);

  // Lazy-load: se renderizan bloques de PAGE filas; al llegar al final (scroll)
  // se cargan las siguientes. `visible` se reinicia al buscar.
  const PAGE = 50;
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // ── Pestaña "Todos los clientes" (score sobre la base completa) ──
  // La puntuación corre en el backend (con caché de 5 min) y se pagina por
  // offset de 500: cada página pide su propia tanda al hacer scroll.
  const [allRows, setAllRows] = useState<ScoredClient[]>([]);
  const [allTotal, setAllTotal] = useState<number | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allLoadingMore, setAllLoadingMore] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const allFetchingRef = useRef(false);
  const allSentinelRef = useRef<HTMLDivElement | null>(null);

  const loadAllPage = async (offset: number, append: boolean) => {
    if (allFetchingRef.current) return;
    allFetchingRef.current = true;
    if (append) setAllLoadingMore(true);
    else setAllLoading(true);
    setAllError(null);
    try {
      const res = await campaignsService.scoreClients({
        filters: filtersRef.current,
        sort: "propensity",
        dir: "desc",
        // Páginas de 20: el resto se carga con el scroll (lazy).
        limit: 20,
        offset,
      });
      setAllRows((prev) => (append ? [...prev, ...res.clients] : res.clients));
      setAllTotal(res.total);
      if (!append) loadedFiltersRef.current = JSON.stringify(filtersRef.current);
    } catch (e) {
      if (!append) setAllError(e instanceof Error ? e.message : "No se pudieron puntuar los clientes");
    } finally {
      allFetchingRef.current = false;
      if (append) setAllLoadingMore(false);
      else setAllLoading(false);
    }
  };

  // Al abrir la pestaña "todos" se puntúa desde cero (solo la primera vez).
  useEffect(() => {
    if (tab !== "all") return;
    if (allRows.length > 0 || allLoading || allTotal != null) return;
    void loadAllPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Al cambiar un filtro (con la pestaña "todos" abierta) se recarga la lista.
  useEffect(() => {
    if (tab !== "all") return;
    if (JSON.stringify(filtersRef.current) === loadedFiltersRef.current) return;
    const t = setTimeout(() => {
      setAllRows([]);
      setAllTotal(null);
      void loadAllPage(0, false);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ...f.deps]);

  useEffect(() => {
    setVisible(PAGE);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (preset) {
        setRecipients(preset.map((r, i) => ({ id: i, ...r })));
        setLoading(false);
        return;
      }
      if (campaignId == null) return;
      setLoading(true);
      setError(null);
      try {
        const list = await campaignsService.getRecipients(campaignId);
        if (!cancelled) setRecipients(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "No se pudieron cargar los clientes");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, preset]);

  const q = query.trim().toLowerCase();
  const filtered = recipients.filter((r) =>
    !q ||
    (r.name ?? "").toLowerCase().includes(q) ||
    (r.email ?? "").toLowerCase().includes(q) ||
    (r.phone ?? "").toLowerCase().includes(q),
  );
  const shown = filtered.slice(0, visible);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => v + PAGE);
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  const allFiltered = allRows.filter((c) =>
    !q ||
    (c.name ?? "").toLowerCase().includes(q) ||
    c.cedula.includes(q) ||
    (c.email ?? "").toLowerCase().includes(q) ||
    (c.phone ?? "").toLowerCase().includes(q),
  );

  // Scroll infinito en "todos": pide la siguiente página al llegar al final.
  useEffect(() => {
    const el = allSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          !allFetchingRef.current &&
          allTotal != null &&
          allRows.length < allTotal
        ) {
          void loadAllPage(allRows.length, true);
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTotal, allRows.length, q]);

  const initials = (name: string | null) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Users size={18} className="text-amber-600" /> {title}
              {explain && (
                <button
                  onClick={() => setExplainOpen(true)}
                  title="¿Cómo se escogieron los clientes?"
                  className="animate-soft-pulse group flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 px-3 py-1.5 text-[11px] font-bold text-amber-950 shadow-sm transition-all hover:shadow-md hover:scale-105 active:scale-95"
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/85 text-[10px] font-black">?</span>
                  ¿Cómo se escogieron los clientes?
                </button>
              )}
            </h3>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Toolbar: pestañas + búsqueda + segmentación manual */}
        <div className="px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
              <button
                onClick={() => setTab("seg")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === "seg" ? "bg-white shadow-sm text-gray-800" : "text-gray-500 hover:text-gray-700"}`}
              >
                Segmentados
              </button>
              <button
                onClick={() => setTab("all")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === "all" ? "bg-white shadow-sm text-gray-800" : "text-gray-500 hover:text-gray-700"}`}
              >
                Todos los clientes
              </button>
            </div>
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "all" ? "Buscar por nombre, cédula, email o teléfono…" : "Buscar por nombre, email o teléfono…"}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
              />
            </div>
            {onManualSeg && (
              <button
                onClick={onManualSeg}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors shadow-sm shrink-0"
                title="Segmentar clientes manualmente por filtros y añadirlos a la campaña"
              >
                <SlidersHorizontal size={13} /> Segmentar manualmente
              </button>
            )}
          </div>
          {tab === "all" && allTotal != null && (
            <p className="text-[11px] text-gray-400 mt-2">
              {allTotal.toLocaleString()} clientes en la base · ordenados por probabilidad de compra
            </p>
          )}
        </div>

        {/* Barra de filtros del tab "Todos los clientes" */}
        {tab === "all" && (
          <div className="px-6 py-2.5 border-b border-gray-100 shrink-0 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilterModalOpen(true)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl border-2 transition-all cursor-pointer ${
                f.hasFilters
                  ? "border-amber-400 bg-amber-50 text-amber-900 shadow-sm"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800"
              }`}
            >
              <SlidersHorizontal size={13} />
              Filtros de segmentación
              {f.hasFilters && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-900 text-[10px] font-bold">
                  {countActiveFilters(f.snapshot)}
                </span>
              )}
            </button>
            {f.hasFilters ? (
              <>
                <span className="text-[11px] text-gray-400">
                  {countActiveFilters(f.snapshot)} filtro{countActiveFilters(f.snapshot) !== 1 ? "s" : ""} activo{countActiveFilters(f.snapshot) !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => {
                    f.reset();
                    setFilterModalOpen(false);
                  }}
                  className="text-[11px] font-semibold text-gray-400 hover:text-red-600 underline underline-offset-2"
                >
                  Limpiar filtros
                </button>
              </>
            ) : (
              <span className="text-[11px] text-gray-400">Define filtros manuales (ubicación, género, edad, perfil de compra…) para afinar la base.</span>
            )}
          </div>
        )}

        {/* List / tabla */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === "seg" ? (
            loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <RefreshCw size={22} className="text-gray-300 animate-spin" />
                <p className="text-xs text-gray-400">Cargando clientes…</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm font-semibold text-red-600">{error}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users size={24} className="text-gray-300 mb-3" />
                <p className="text-sm font-semibold text-gray-700">
                  {recipients.length === 0 ? "Sin clientes" : "Sin resultados"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {recipients.length === 0
                    ? "No hay clientes que cumplan el estándar de esta segmentación."
                    : "Ningún cliente coincide con la búsqueda."}
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wide pb-2">
                  <span>Cliente</span>
                  <span>Probabilidad</span>
                </div>
                <ul className="divide-y divide-gray-100">
                  {shown.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                      {initials(r.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{r.name ?? "Sin nombre"}</p>
                      <p className="text-xs text-gray-400 truncate">{r.email ?? "Sin email"}</p>
                    </div>
                    <div className="text-right shrink-0 min-w-20">
                      <p className="text-xs text-gray-500">{r.phone ?? "—"}</p>
                      {r.propensity != null ? (
                        <span className={`inline-block mt-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${scoreColor(r.propensity)}`}>
                          Prob. {Math.round(r.propensity * 100)}%
                        </span>
                      ) : (
                        <span className="inline-block mt-1 text-[11px] font-semibold text-gray-300">—</span>
                      )}
                      {r.status && <p className="text-[10px] font-bold text-gray-400 uppercase">{r.status}</p>}
                    </div>
                  </li>
                ))}
                </ul>
                {visible < filtered.length && (
                  <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
                    <RefreshCw size={13} className="animate-spin" /> Cargando más clientes…
                  </div>
                )}
              </div>
            )
          ) : allLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <RefreshCw size={22} className="text-amber-400 animate-spin" />
              <p className="text-sm font-semibold text-gray-700">Puntuando toda la base de clientes…</p>
              <p className="text-xs text-gray-400 max-w-xs">
                La primera vez puede tardar un par de minutos (XGBoost + Uplift sobre toda la base); después queda en caché.
              </p>
            </div>
          ) : allError ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm font-semibold text-red-600">{allError}</p>
              <button
                onClick={() => void loadAllPage(0, false)}
                className="mt-4 px-4 py-2 text-xs font-bold text-amber-900 bg-amber-400 rounded-xl hover:bg-amber-500 transition-colors"
              >
                Reintentar
              </button>
            </div>
          ) : allFiltered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users size={24} className="text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-700">Sin resultados</p>
              <p className="text-xs text-gray-400 mt-1">Ningún cliente coincide con la búsqueda.</p>
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="py-2 pr-3">Cliente</th>
                      <th className="py-2 pr-3">Seg</th>
                      <th className="py-2 pr-3">Frec</th>
                      <th className="py-2 pr-3">Monetario</th>
                      <th className="py-2 pr-3">Ticket</th>
                      <th className="py-2 pr-3">Cat</th>
                      <th className="py-2 text-right">Probabilidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {allFiltered.map((c) => (
                      <tr key={c.cedula} className="hover:bg-amber-50/40">
                        <td className="py-2.5 pr-3">
                          <p className="text-xs font-bold text-gray-900 truncate max-w-44">{c.name ?? "Sin nombre"}</p>
                          <p className="text-[10px] text-gray-400">{c.cedula}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="inline-block text-[10px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-md">S{c.segment}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{Math.round(c.features.frecuencia).toLocaleString()}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{fmtMoney(c.features.monetario)}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{fmtMoney(c.features.ticket_promedio)}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{Math.round(c.features.categorias_distintas)}</td>
                        <td className="py-2.5 text-right">
                          <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${scoreColor(c.propensity)}`}>
                            {Math.round(c.propensity * 100)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {allTotal != null && allRows.length < allTotal && (
                <div ref={allSentinelRef} className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
                  <RefreshCw size={13} className="animate-spin" /> {allLoadingMore ? "Cargando más clientes…" : "…"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {explainOpen && explain && (
        <ExplainModal ctx={explain} onClose={() => setExplainOpen(false)} />
      )}

      {/* Modal de filtros de segmentación (tab "Todos los clientes") */}
      <SegmentFiltersModal
        open={filterModalOpen}
        initial={f.snapshot}
        onClose={() => setFilterModalOpen(false)}
        onApply={(vals) => {
          f.apply(vals);
          setFilterModalOpen(false);
        }}
      />
    </div>
  );
}

/* ─── Segmentación manual por filtros (RFM + analítica) ── */

/** Par de inputs min/max para un filtro numérico. */
function RangeInputs({
  label,
  min,
  max,
  onMin,
  onMax,
  step = 1,
  disabled = false,
  hint,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  step?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const inputCls =
    "w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white disabled:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed";
  return (
    <div title={disabled ? hint : undefined}>
      <label className={`block text-[11px] font-semibold mb-1 ${disabled ? "text-gray-300" : "text-gray-500"}`}>{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step={step}
          min={0}
          value={min}
          onChange={(e) => onMin(e.target.value)}
          placeholder="Mín"
          disabled={disabled}
          className={inputCls}
        />
        <span className="text-gray-300 text-xs">—</span>
        <input
          type="number"
          step={step}
          min={0}
          value={max}
          onChange={(e) => onMax(e.target.value)}
          placeholder="Máx"
          disabled={disabled}
          className={inputCls}
        />
      </div>
    </div>
  );
}

/** Tarjeta de sección de filtros (ícono + título + grid de controles). */
function FilterSection({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3">
      <header className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          <Icon size={13} />
        </span>
        <h4 className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">{title}</h4>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{children}</div>
    </section>
  );
}

/** Multi-select compacto con búsqueda (dropdown anclado, sin recortes). */
function MultiSelect({
  label,
  options,
  values,
  onChange,
  placeholder = "Todos",
  disabled = false,
  hint,
}: {
  label: string;
  options: string[];
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const PANEL_MAX_H = 232;

  const close = () => {
    setOpen(false);
    setQ("");
    setPos(null);
  };

  const toggleOpen = () => {
    if (disabled) return;
    if (open) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const openUp = spaceBelow < PANEL_MAX_H && r.top - margin > PANEL_MAX_H;
    setPos({
      top: openUp ? Math.max(margin, r.top - PANEL_MAX_H - margin) : r.bottom + 4,
      left: r.left,
      width: r.width,
      openUp,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current && btnRef.current.contains(t)) return;
      const panel = document.getElementById("multiselect-panel");
      if (panel && panel.contains(t)) return;
      close();
    };
    const onScroll = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (o: string) => {
    onChange(values.includes(o) ? values.filter((x) => x !== o) : [...values, o]);
  };

  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const shown = q ? filtered : options.slice(0, 80);

  return (
    <div title={disabled ? hint : undefined}>
      <label className={`block text-[11px] font-semibold mb-1 ${disabled ? "text-gray-300" : "text-gray-500"}`}>{label}</label>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border bg-white focus:outline-none transition-colors ${
          disabled
            ? "border-gray-100 text-gray-300 cursor-not-allowed"
            : values.length
              ? "border-amber-400 bg-amber-50 text-amber-900 font-semibold shadow-sm"
              : "border-gray-200 text-gray-600 hover:border-gray-300"
        }`}
      >
        <span className="truncate text-left">
          {disabled
            ? "Sin datos suficientes"
            : values.length
              ? `${values.length} seleccionado${values.length !== 1 ? "s" : ""}`
              : placeholder}
        </span>
        <ChevronDown size={12} className={`text-gray-300 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {!disabled && open && pos && (
        <div
          id="multiselect-panel"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: Math.max(pos.width, 200),
            maxHeight: PANEL_MAX_H,
            zIndex: 9999,
          }}
          className="overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl p-1.5"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg mb-1 focus:outline-none focus:ring-2 focus:ring-amber-300 sticky top-0 bg-white"
          />
          {shown.length === 0 ? (
            <p className="px-2 py-2 text-xs text-gray-400">Sin opciones</p>
          ) : (
            shown.map((o) => (
              <label
                key={o}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-700 hover:bg-amber-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={values.includes(o)}
                  onChange={() => toggle(o)}
                  className="accent-amber-500 w-3.5 h-3.5 shrink-0"
                />
                <span className="truncate">{o}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Checkbox booleano de filtro (marcado = filtrar por true). */
function BoolCheck({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      title={disabled ? hint : undefined}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-white text-xs cursor-pointer select-none ${
        disabled
          ? "border-gray-100 text-gray-300 cursor-not-allowed opacity-70"
          : "border-gray-200 text-gray-600 hover:border-gray-300"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="accent-amber-500 w-3.5 h-3.5 disabled:opacity-40"
      />
      {label}
    </label>
  );
}

/* ─── Estado compartido de filtros manuales (perfil + RFM) ── */

interface ManualFilterValues {
  segment: string;
  minF: string; maxF: string; minM: string; maxM: string;
  minT: string; maxT: string; minC: string; maxC: string;
  ciudades: string[]; barrios: string[]; direccion: string;
  sexos: string[]; minEdad: string; maxEdad: string;
  estadosCiviles: string[]; minHijos: string; maxHijos: string;
  profesiones: string[];
  minValor: string; maxValor: string; minPuntos: string; maxPuntos: string;
  tieneMascota: boolean; tieneCarro: boolean; esEmpleado: boolean;
  clubs: string[]; consentimientos: string[];
}

const DEFAULT_FILTER_VALUES: ManualFilterValues = {
  segment: "",
  minF: "", maxF: "", minM: "", maxM: "", minT: "", maxT: "", minC: "", maxC: "",
  ciudades: [], barrios: [], direccion: "",
  sexos: [], minEdad: "", maxEdad: "",
  estadosCiviles: [], minHijos: "", maxHijos: "", profesiones: [],
  minValor: "", maxValor: "", minPuntos: "", maxPuntos: "",
  tieneMascota: false, tieneCarro: false, esEmpleado: false,
  clubs: [], consentimientos: [],
};

function useManualFilters() {
  const [values, setValues] = useState<ManualFilterValues>(DEFAULT_FILTER_VALUES);
  const [options, setOptions] = useState<ClientFilterOptions | null>(null);

  useEffect(() => {
    campaignsService
      .getFilterOptions()
      .then(setOptions)
      .catch(() => {});
  }, []);

  const set = useCallback(
    <K extends keyof ManualFilterValues>(k: K, v: ManualFilterValues[K]) =>
      setValues((prev) => ({ ...prev, [k]: v })),
    [],
  );
  const reset = useCallback(() => setValues(DEFAULT_FILTER_VALUES), []);

  const buildFilters = useCallback((): NonNullable<ScoreClientsPayload["filters"]> => {
    const f: NonNullable<ScoreClientsPayload["filters"]> = {};
    if (values.segment) f.segment = Number(values.segment);
    if (values.minF) f.minFrecuencia = Number(values.minF);
    if (values.maxF) f.maxFrecuencia = Number(values.maxF);
    if (values.minM) f.minMonetario = Number(values.minM);
    if (values.maxM) f.maxMonetario = Number(values.maxM);
    if (values.minT) f.minTicketPromedio = Number(values.minT);
    if (values.maxT) f.maxTicketPromedio = Number(values.maxT);
    if (values.minC) f.minCategoriasDistintas = Number(values.minC);
    if (values.maxC) f.maxCategoriasDistintas = Number(values.maxC);
    if (values.ciudades.length) f.ciudades = values.ciudades;
    if (values.barrios.length) f.barrios = values.barrios;
    if (values.direccion.trim()) f.direccionContiene = values.direccion.trim();
    if (values.sexos.length) f.sexos = values.sexos;
    if (values.minEdad) f.minEdad = Number(values.minEdad);
    if (values.maxEdad) f.maxEdad = Number(values.maxEdad);
    if (values.estadosCiviles.length) f.estadosCiviles = values.estadosCiviles;
    if (values.minHijos) f.minHijos = Number(values.minHijos);
    if (values.maxHijos) f.maxHijos = Number(values.maxHijos);
    if (values.profesiones.length) f.profesiones = values.profesiones;
    if (values.minValor) f.minValorTotal = Number(values.minValor);
    if (values.maxValor) f.maxValorTotal = Number(values.maxValor);
    if (values.minPuntos) f.minPuntos = Number(values.minPuntos);
    if (values.maxPuntos) f.maxPuntos = Number(values.maxPuntos);
    if (values.tieneMascota) f.tieneMascota = true;
    if (values.tieneCarro) f.tieneCarro = true;
    if (values.esEmpleado) f.esEmpleado = true;
    if (values.clubs.length) f.clubs = values.clubs;
    if (values.consentimientos.length) f.consentimientos = values.consentimientos;
    return f;
  }, [values]);

  const deps = [
    values.segment, values.minF, values.maxF, values.minM, values.maxM,
    values.minT, values.maxT, values.minC, values.maxC,
    values.ciudades, values.barrios, values.direccion, values.sexos,
    values.minEdad, values.maxEdad, values.estadosCiviles,
    values.minHijos, values.maxHijos, values.profesiones,
    values.minValor, values.maxValor, values.minPuntos, values.maxPuntos,
    values.tieneMascota, values.tieneCarro, values.esEmpleado,
    values.clubs, values.consentimientos,
  ];

  return {
    values,
    set,
    reset,
    options,
    buildFilters,
    apply: setValues,
    snapshot: values,
    hasFilters: Object.keys(buildFilters()).length > 0,
    deps,
  };
}

/** Panel de filtros manuales (perfil + RFM), compartido por los modales. */
// Listas de respaldo con valores reales de la réplica: si el endpoint de
// opciones no responde, los selects igual muestran opciones útiles.
const FALLBACK_CIUDADES = ["MANIZALES", "VILLAMARIA", "PEREIRA", "BOGOTA, D.C.", "MEDELLIN", "CALI", "NEIRA", "CHINCHINA", "DOSQUEBRADAS", "ARMENIA", "BOGOTA", "IBAGUE", "CARTAGO", "LA DORADA", "ENVIGADO"];
const FALLBACK_BARRIOS = ["PALERMO", "ENEA", "CENTRO", "CHIPRE", "SULTANA", "FATIMA", "SAN JORGE", "LA SULTANA", "VILLA PILAR", "LA ENEA", "NEIRA", "COMUNA UNIVERSITARIA"];
const FALLBACK_PROFESIONES = ["Ama de casa", "Independiente", "Empleado", "Estudiante", "Jubilado(a)", "Comerciante", "Docente", "Ingeniero(a)", "Abogado(a)", "Enfermero(a)", "Auxiliar", "Administrador(a)", "Otra"];
const FALLBACK_ESTADOS_CIVILES = ["Soltero(a)", "Casado(a)", "Union Libre", "Separado(a)", "Viudo(a)"];

function ManualFiltersPanel({ f }: { f: ReturnType<typeof useManualFilters> }) {
  const v = f.values;
  const set = f.set;
  const optCiudades = f.options?.ciudades?.length ? f.options.ciudades : FALLBACK_CIUDADES;
  const optBarrios = f.options?.barrios?.length ? f.options.barrios : FALLBACK_BARRIOS;
  const optProfesiones = f.options?.profesiones?.length ? f.options.profesiones : FALLBACK_PROFESIONES;
  const optEstados = f.options?.estadosCiviles?.length ? f.options.estadosCiviles : FALLBACK_ESTADOS_CIVILES;
  const optSexos = f.options?.sexos?.length ? f.options.sexos : ["F", "M"];
  const inputCls =
    "w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 transition-shadow";
  return (
    <div className="space-y-3">
      <FilterSection icon={MapPin} title="Ubicación">
        <MultiSelect label="Ciudad" options={optCiudades} values={v.ciudades} onChange={(x) => set("ciudades", x)} />
        <MultiSelect label="Barrio" options={optBarrios} values={v.barrios} onChange={(x) => set("barrios", x)} />
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Dirección contiene</label>
          <input
            type="text"
            value={v.direccion}
            onChange={(e) => set("direccion", e.target.value)}
            placeholder="Ej: Cra 23"
            className={inputCls}
          />
        </div>
      </FilterSection>

      <FilterSection icon={Users} title="Demografía">
        <MultiSelect label="Sexo" options={optSexos} values={v.sexos} onChange={(x) => set("sexos", x)} />
        <RangeInputs label="Edad (años)" min={v.minEdad} max={v.maxEdad} onMin={(x) => set("minEdad", x)} onMax={(x) => set("maxEdad", x)} />
        <MultiSelect
          label="Estado civil"
          options={optEstados}
          values={v.estadosCiviles}
          onChange={(x) => set("estadosCiviles", x)}
        />
        <RangeInputs label="Hijos" min={v.minHijos} max={v.maxHijos} onMin={(x) => set("minHijos", x)} onMax={(x) => set("maxHijos", x)} />
        <MultiSelect label="Profesión" options={optProfesiones} values={v.profesiones} onChange={(x) => set("profesiones", x)} />
      </FilterSection>

      <FilterSection icon={Wallet} title="Económico (proxy de ingresos)">
        <RangeInputs label="Valor total histórico (compras)" min={v.minValor} max={v.maxValor} onMin={(x) => set("minValor", x)} onMax={(x) => set("maxValor", x)} step={50000} />
        <RangeInputs label="Puntos de fidelidad" min={v.minPuntos} max={v.maxPuntos} onMin={(x) => set("minPuntos", x)} onMax={(x) => set("maxPuntos", x)} step={1000} />
      </FilterSection>

      <FilterSection icon={PawPrint} title="Estilo de vida">
        <MultiSelect
          label="Clubs (alguno)"
          options={["vino", "parrilla", "salud", "mascotas", "amas_de_casa"]}
          values={v.clubs}
          onChange={(x) => set("clubs", x)}
        />
        <div className="flex flex-wrap items-end gap-2 pb-0.5">
          <BoolCheck
            label="Tiene mascota"
            checked={v.tieneMascota}
            onChange={(x) => set("tieneMascota", x)}
            disabled
            hint="Sin datos suficientes: solo ~9 % de la base puntuada registra este atributo."
          />
          <BoolCheck
            label="Tiene carro"
            checked={v.tieneCarro}
            onChange={(x) => set("tieneCarro", x)}
            disabled
            hint="Sin datos suficientes: solo ~8 % de la base puntuada registra este atributo."
          />
          <BoolCheck
            label="Es empleado"
            checked={v.esEmpleado}
            onChange={(x) => set("esEmpleado", x)}
            disabled
            hint="Sin datos suficientes: menos del 1 % de la base puntuada es empleado de la empresa."
          />
        </div>
      </FilterSection>

      <FilterSection icon={ShieldCheck} title="Consentimiento">
        <MultiSelect
          label="Con consentimiento para (alguno)"
          options={["email", "whatsapp", "sms"]}
          values={v.consentimientos}
          onChange={(x) => set("consentimientos", x)}
        />
      </FilterSection>

      <FilterSection icon={BarChart2} title="RFM">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Segmento</label>
          <select value={v.segment} onChange={(e) => set("segment", e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {[0, 1, 2, 3, 4, 5].map((s) => (
              <option key={s} value={s}>Segmento {s}</option>
            ))}
          </select>
        </div>
        <RangeInputs label="Frecuencia (compras)" min={v.minF} max={v.maxF} onMin={(x) => set("minF", x)} onMax={(x) => set("maxF", x)} />
        <RangeInputs label="Monetario (gasto)" min={v.minM} max={v.maxM} onMin={(x) => set("minM", x)} onMax={(x) => set("maxM", x)} step={10000} />
        <RangeInputs label="Ticket promedio" min={v.minT} max={v.maxT} onMin={(x) => set("minT", x)} onMax={(x) => set("maxT", x)} step={1000} />
        <RangeInputs label="Categorías distintas" min={v.minC} max={v.maxC} onMin={(x) => set("minC", x)} onMax={(x) => set("maxC", x)} />
      </FilterSection>
    </div>
  );
}

/** Nº de criterios activos (para el badge de la barra de filtros). */
function countActiveFilters(v: ManualFilterValues): number {
  const ranged = (a: string, b: string) => (a ? 1 : 0) + (b ? 1 : 0);
  return (
    (v.segment ? 1 : 0) +
    ranged(v.minF, v.maxF) +
    ranged(v.minM, v.maxM) +
    ranged(v.minT, v.maxT) +
    ranged(v.minC, v.maxC) +
    (v.ciudades.length ? 1 : 0) +
    (v.barrios.length ? 1 : 0) +
    (v.direccion.trim() ? 1 : 0) +
    (v.sexos.length ? 1 : 0) +
    ranged(v.minEdad, v.maxEdad) +
    (v.estadosCiviles.length ? 1 : 0) +
    ranged(v.minHijos, v.maxHijos) +
    (v.profesiones.length ? 1 : 0) +
    ranged(v.minValor, v.maxValor) +
    ranged(v.minPuntos, v.maxPuntos) +
    (v.tieneMascota ? 1 : 0) +
    (v.tieneCarro ? 1 : 0) +
    (v.esEmpleado ? 1 : 0) +
    (v.clubs.length ? 1 : 0) +
    (v.consentimientos.length ? 1 : 0)
  );
}

/** Modal de filtros de segmentación (borrador + botón "Aplicar"). */
function SegmentFiltersModal({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: ManualFilterValues;
  onClose: () => void;
  onApply: (v: ManualFilterValues) => void;
}) {
  const f = useManualFilters();

  // Al abrir, el borrador parte de los filtros ya aplicados.
  useEffect(() => {
    if (open) f.apply(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const n = countActiveFilters(f.snapshot);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-50 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 bg-white border-b border-gray-200 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <SlidersHorizontal size={18} className="text-amber-600" /> Filtros de segmentación
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Afina la base por ubicación, demografía, perfil económico y de compra. Los cambios se aplican al pulsar “Aplicar filtros”.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ManualFiltersPanel f={f} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-6 py-3 bg-white border-t border-gray-200 shrink-0">
          <button
            onClick={() => f.reset()}
            disabled={n === 0}
            className="text-xs font-semibold text-gray-500 hover:text-red-600 underline underline-offset-2 disabled:opacity-40 disabled:no-underline disabled:cursor-default"
          >
            Limpiar todo
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => onApply(f.snapshot)}
              disabled={n === 0}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap size={13} />
              {n > 0 ? `Aplicar filtros (${n})` : "Aplicar filtros"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualSegModal({
  campaignId,
  campaignName,
  onAdded,
  onClose,
}: {
  campaignId: number;
  campaignName: string;
  onAdded: (n: number) => void;
  onClose: () => void;
}) {
  // Solo clientes con ≥70% de probabilidad de compra (estándar de la campaña).
  const [onlyHigh, setOnlyHigh] = useState(true);

  // Filtros manuales compartidos (perfil + RFM) con opciones de la réplica.
  const f = useManualFilters();
  const { buildFilters, hasFilters } = f;

  const [rows, setRows] = useState<ScoredClient[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const fetchRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const runAnalysis = async (offset = 0, append = false) => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    setAddedMsg(null);
    try {
      const res = await campaignsService.scoreClients({
        filters: buildFilters(),
        minPropensity: onlyHigh ? 0.7 : undefined,
        sort: "propensity",
        dir: "desc",
        limit: 500,
        offset,
      });
      setRows((prev) => (append ? [...prev, ...res.clients] : res.clients));
      setTotal(res.total);
    } catch (e) {
      if (!append) setError(e instanceof Error ? e.message : "No se pudo ejecutar la analítica");
    } finally {
      fetchRef.current = false;
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };

  const toggleRow = (cedula: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cedula)) next.delete(cedula);
      else next.add(cedula);
      return next;
    });
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.cedula));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => {
        if (allSelected) next.delete(r.cedula);
        else next.add(r.cedula);
      });
      return next;
    });
  };

  const handleAdd = async () => {
    if (!selected.size) return;
    setAdding(true);
    setAddedMsg(null);
    try {
      const res = await campaignsService.addManualRecipients(campaignId, [...selected]);
      setAddedMsg(`Se añadieron ${res.added} clientes a la campaña.`);
      setSelected(new Set());
      onAdded(res.added);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron añadir los clientes");
    } finally {
      setAdding(false);
    }
  };

  // Scroll infinito: pide la siguiente página al llegar al final.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetchRef.current && total != null && rows.length < total) {
          void runAnalysis(rows.length, true);
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, rows.length, onlyHigh, ...f.deps]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <SlidersHorizontal size={18} className="text-amber-600" /> Segmentar manualmente
            </h3>
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              {campaignName} · filtra la base de clientes, ejecuta analítica y añádelos a la campaña
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Filtros */}
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="max-h-[46vh] overflow-y-auto pr-1">
            <ManualFiltersPanel f={f} />
          </div>
          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyHigh}
                onChange={(e) => setOnlyHigh(e.target.checked)}
                className="accent-amber-500 w-3.5 h-3.5"
              />
              Solo clientes con <strong>≥70% de probabilidad de compra</strong>
            </label>
            <button
              onClick={() => void runAnalysis(0, false)}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Zap size={13} />
              {loading ? "Analizando…" : hasFilters ? "Aplicar y analizar" : "Analizar toda la base"}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
              ⚠ {error}
            </p>
          )}
          {addedMsg && (
            <p className="mt-3 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-2 flex items-center gap-1.5">
              <CheckSquare size={13} /> {addedMsg}
            </p>
          )}
        </div>

        {/* Resultados */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <RefreshCw size={22} className="text-amber-400 animate-spin" />
              <p className="text-sm font-semibold text-gray-700">Ejecutando analítica sobre los clientes filtrados…</p>
              <p className="text-xs text-gray-400 max-w-xs">
                Se calcula la probabilidad de compra (XGBoost) y la persuasibilidad (Uplift) de cada cliente.
              </p>
            </div>
          ) : rows.length === 0 && total == null && !error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Filter size={24} className="text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-700">Sin análisis todavía</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">
                Define los filtros (o ninguno para toda la base) y pulsa “Aplicar y analizar” para ver los clientes con su probabilidad de compra.
              </p>
            </div>
          ) : rows.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users size={24} className="text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-700">Sin resultados</p>
              <p className="text-xs text-gray-400 mt-1">Ningún cliente cumple los filtros seleccionados.</p>
            </div>
          ) : rows.length > 0 ? (
            <div>
              <div className="flex items-center justify-between pb-2">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-amber-500 w-3.5 h-3.5"
                  />
                  <strong>{selected.size.toLocaleString()}</strong> seleccionados de {total?.toLocaleString() ?? rows.length.toLocaleString()} resultados
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="py-2 pr-3">Cliente</th>
                      <th className="py-2 pr-3">Seg</th>
                      <th className="py-2 pr-3">Frec</th>
                      <th className="py-2 pr-3">Monetario</th>
                      <th className="py-2 pr-3">Ticket</th>
                      <th className="py-2 pr-3">Cat</th>
                      <th className="py-2 text-right">Probabilidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((c) => (
                      <tr
                        key={c.cedula}
                        onClick={() => toggleRow(c.cedula)}
                        className={`cursor-pointer transition-colors ${selected.has(c.cedula) ? "bg-amber-50" : "hover:bg-amber-50/40"}`}
                      >
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected.has(c.cedula)}
                              onChange={() => toggleRow(c.cedula)}
                              onClick={(e) => e.stopPropagation()}
                              className="accent-amber-500 w-3.5 h-3.5 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate max-w-40">{c.name ?? "Sin nombre"}</p>
                              <p className="text-[10px] text-gray-400">{c.cedula}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="inline-block text-[10px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-md">S{c.segment}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{Math.round(c.features.frecuencia).toLocaleString()}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{fmtMoney(c.features.monetario)}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{fmtMoney(c.features.ticket_promedio)}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{Math.round(c.features.categorias_distintas)}</td>
                        <td className="py-2.5 text-right">
                          <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${scoreColor(c.propensity)}`}>
                            {Math.round(c.propensity * 100)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total != null && rows.length < total && (
                <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
                  <RefreshCw size={13} className="animate-spin" /> {loadingMore ? "Cargando más clientes…" : "…"}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer: añadir a la campaña */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            {selected.size > 0
              ? `${selected.size.toLocaleString()} cliente${selected.size === 1 ? "" : "s"} por añadir a los destinatarios de la campaña.`
              : "Selecciona clientes de los resultados para añadirlos a la campaña."}
          </p>
          <button
            onClick={() => void handleAdd()}
            disabled={selected.size === 0 || adding}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Plus size={14} /> {adding ? "Añadiendo…" : `Añadir ${selected.size.toLocaleString()} a la campaña`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Acciones de campaña (editar / relanzar / historial / eliminar) ── */

function ConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              danger ? "bg-red-500 text-white hover:bg-red-600" : "bg-amber-400 text-amber-900 hover:bg-amber-500"
            }`}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  created: "Creación",
  updated: "Edición",
  deleted: "Eliminación",
  relaunched: "Relanzamiento",
  scheduled: "Programación",
};

function HistoryModal({
  entries,
  loading,
  onClose,
}: {
  entries: CampaignHistoryEntry[];
  loading?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <History size={18} className="text-amber-600" /> Historial de la campaña
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-400">
              <RefreshCw size={14} className="animate-spin" /> Cargando historial…
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">Sin eventos registrados</p>
          ) : (
            <div className="space-y-3">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-800">
                        {HISTORY_LABELS[e.action] ?? e.action}
                        {e.status && (
                          <span className="ml-1.5 text-[10px] font-bold text-gray-400 uppercase">
                            {STATUS_CFG[e.status as CampaignStatus]?.label ?? e.status}
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-400">{new Date(e.createdAt).toLocaleString()}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {e.action === "created" &&
                        `Campaña creada · ${e.details?.messages ?? 0} mensajes · modo ${e.details?.mode ?? "multi"}`}
                      {e.action === "updated" && "Contenido y ajustes modificados"}
                      {e.action === "deleted" && "Campaña eliminada (el historial se conserva)"}
                      {e.action === "relaunched" &&
                        `Relanzada · ${e.details?.recipientsCount ?? 0} destinatarios re-segmentados · modo ${e.details?.mode ?? "multi"}`}
                      {e.action === "scheduled" && `Programada para ${e.details?.scheduledAt ?? "—"}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditCampaignModal({
  id,
  onClose,
  onSaved,
}: {
  id: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [campaign, setCampaign] = useState<ApiCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [msgs, setMsgs] = useState<Record<string, { subject: string; content: string }>>({});
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    campaignsService
      .get(id)
      .then((c) => {
        if (cancelled) return;
        setCampaign(c);
        setName(c.name);
        const m: Record<string, { subject: string; content: string }> = {};
        for (const msg of c.messages) {
          m[msg.channel] = { subject: msg.subject ?? "", content: msg.content ?? "" };
        }
        setMsgs(m);
        setScheduled(!!c.scheduledAt);
        if (c.scheduledAt) {
          const d = new Date(c.scheduledAt);
          setDate(d.toISOString().slice(0, 10));
          setTime(d.toISOString().slice(11, 16));
        }
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "No se pudo cargar la campaña");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const save = async () => {
    if (!campaign) return;
    setSaving(true);
    setError(null);
    try {
      const messages = campaign.channels.map((ch) => ({
        channel: ch,
        subject: ch === "email" ? msgs[ch]?.subject ?? "" : undefined,
        content: msgs[ch]?.content ?? "",
      }));
      await campaignsService.update(id, {
        name,
        messages,
        ...(scheduled
          ? { scheduledAt: `${date || new Date().toISOString().slice(0, 10)}T${time || "09:00"}:00`, status: "programada" as const }
          : {}),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando la campaña");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Pencil size={17} className="text-amber-600" /> Editar campaña
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-400">
              <RefreshCw size={14} className="animate-spin" /> Cargando…
            </div>
          ) : error ? (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">⚠ {error}</div>
          ) : campaign ? (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Nombre</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                />
              </div>

              <div className="space-y-3">
                {campaign.channels.map((ch) => {
                  const cfg = CHANNEL_CFG[ch as keyof typeof CHANNEL_CFG];
                  return (
                    <div key={ch} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${cfg.bg}`}>
                          <cfg.icon size={12} className="text-white" />
                        </span>
                        <span className="text-xs font-bold text-gray-700">{cfg.label}</span>
                      </div>
                      {ch === "email" && (
                        <input
                          value={msgs[ch]?.subject ?? ""}
                          onChange={(e) => setMsgs((prev) => ({ ...prev, [ch]: { ...prev[ch], subject: e.target.value } }))}
                          placeholder="Asunto"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl mb-2 focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                        />
                      )}
                      <textarea
                        value={msgs[ch]?.content ?? ""}
                        onChange={(e) => setMsgs((prev) => ({ ...prev, [ch]: { ...prev[ch], content: e.target.value } }))}
                        placeholder="Contenido del mensaje…"
                        rows={3}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white resize-y"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-800">¿Programar el envío?</p>
                <div className="flex items-center bg-gray-100 rounded-xl p-1">
                  <button onClick={() => setScheduled(false)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${!scheduled ? "bg-white shadow-sm text-gray-800" : "text-gray-500"}`}>
                    Ahora
                  </button>
                  <button onClick={() => setScheduled(true)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${scheduled ? "bg-white shadow-sm text-gray-800" : "text-gray-500"}`}>
                    Programar
                  </button>
                </div>
              </div>
              {scheduled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Fecha</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Hora</label>
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white" />
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
          {error && <p className="text-xs font-semibold text-red-600 flex-1">⚠ {error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || loading}
              className="px-4 py-2 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-all disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Campaign list ─────────────────────────────── */
function CampaignCard({
  c,
  onViewClients,
  onManualSeg,
  onEdit,
  onRelaunch,
  onHistory,
  onDelete,
}: {
  c: CampaignCardData;
  onViewClients: () => void;
  onManualSeg: () => void;
  onEdit: () => void;
  onRelaunch: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const cfg = STATUS_CFG[c.status];
  const openRate = c.sent > 0 ? Math.round((c.opens / c.sent) * 100) : 0;
  const [menu, setMenu] = useState(false);

  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 pr-3">
          <p className="font-bold text-gray-900 truncate">{c.name}</p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{c.product}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
            {cfg.label}
          </span>
          <button
            onClick={() => setMenu((m) => !m)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            title="Acciones"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div className="absolute right-3 top-12 z-40 w-44 bg-white rounded-xl border border-gray-100 shadow-xl py-1.5">
            <button
              onClick={() => { setMenu(false); onEdit(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Pencil size={12} /> Editar
            </button>
            <button
              onClick={() => { setMenu(false); onRelaunch(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <RotateCw size={12} /> Relanzar
            </button>
            <button
              onClick={() => { setMenu(false); onHistory(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <History size={12} /> Historial
            </button>
            <div className="my-1 border-t border-gray-100" />
            <button
              onClick={() => { setMenu(false); onDelete(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={12} /> Eliminar
            </button>
          </div>
        </>
      )}

      {/* Channels */}
      <div className="flex items-center gap-1.5 mb-4">
        {c.channels.map((ch) => {
          const cfg = CHANNEL_CFG[ch as keyof typeof CHANNEL_CFG];
          return (
            <div key={ch} className={`w-5 h-5 rounded-md flex items-center justify-center ${cfg.bg}`}>
              <cfg.icon size={11} className="text-white" />
            </div>
          );
        })}
        <button
          onClick={onViewClients}
          className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-semibold transition-colors"
          title="Ver clientes segmentados"
        >
          <Users size={12} /> {c.audience.toLocaleString()} clientes
        </button>
        <button
          onClick={onManualSeg}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-amber-600 font-semibold transition-colors"
          title="Segmentar clientes manualmente por filtros"
        >
          <Filter size={12} /> Segmentar
        </button>
        {c.date && <span className="text-xs text-gray-400 ml-auto">{c.date}</span>}
      </div>

      {/* Stats */}
      {c.sent > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Enviados", value: c.sent.toLocaleString(), color: "text-gray-800" },
            { label: "Abiertos", value: c.opens.toLocaleString(), color: "text-blue-700" },
            { label: "Conversiones", value: c.conversions.toLocaleString(), color: "text-green-700" },
          ].map((s) => (
            <div key={s.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
              <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-gray-400">{s.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-10 bg-gray-50 rounded-xl flex items-center justify-center">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={11} /> {c.status === "programada" ? `Programada para ${c.date}` : "Borrador — sin enviar"}
          </p>
        </div>
      )}

      {/* Open-rate bar */}
      {c.sent > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
            <span>Tasa de apertura</span><span className="font-bold text-gray-600">{openRate}%</span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${openRate}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main view ─────────────────────────────────── */
export default function Campaigns() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "todos">("todos");
  const [search, setSearch] = useState("");
  const [clientsModal, setClientsModal] = useState<CampaignCardData | null>(null);
  const [manualSeg, setManualSeg] = useState<CampaignCardData | null>(null);

  // Acciones: editar / eliminar / relanzar / historial
  const [editing, setEditing] = useState<CampaignCardData | null>(null);
  const [deleting, setDeleting] = useState<CampaignCardData | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [relaunching, setRelaunching] = useState<CampaignCardData | null>(null);
  const [relaunchBusy, setRelaunchBusy] = useState(false);
  const [historyOf, setHistoryOf] = useState<CampaignCardData | null>(null);
  const [historyEntries, setHistoryEntries] = useState<CampaignHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const list = await campaignsService.list();
      setCampaigns(list.map(apiToCard));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "No se pudieron cargar las campañas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreated = (c: CampaignCardData) => {
    setCampaigns((prev) => [c, ...prev]);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await campaignsService.remove(deleting.id);
      setCampaigns((prev) => prev.filter((c) => c.id !== deleting.id));
      setDeleting(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo eliminar la campaña");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRelaunch = async () => {
    if (!relaunching) return;
    setRelaunchBusy(true);
    try {
      const updated = await campaignsService.relaunch(relaunching.id);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? apiToCard(updated) : c)));
      setRelaunching(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo relanzar la campaña");
    } finally {
      setRelaunchBusy(false);
    }
  };

  const handleOpenHistory = async (c: CampaignCardData) => {
    setHistoryOf(c);
    setHistoryLoading(true);
    try {
      setHistoryEntries(await campaignsService.history(c.id));
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const filtered = campaigns.filter((c) => {
    const matchStatus = statusFilter === "todos" || c.status === statusFilter;
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.product.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const activas = campaigns.filter((c) => c.status === "enviando" || c.status === "programada").length;
  const totalSent = campaigns.reduce((a, c) => a + c.sent, 0);
  const avgOpen = campaigns.filter((c) => c.sent > 0).reduce((a, c, _, arr) => a + Math.round((c.opens / c.sent) * 100) / arr.length, 0);
  const totalConv = campaigns.reduce((a, c) => a + c.conversions, 0);

  return (
    <>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Campañas</h1>
            <p className="text-sm text-gray-500 mt-0.5">Automatización de marketing omnicanal en 3 pasos</p>
          </div>
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors shadow-sm hover:shadow-md"
          >
            <Plus size={15} /> Nueva Campaña
          </button>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Campañas activas", value: String(activas), icon: Zap, color: "bg-amber-100 text-amber-600" },
            { label: "Mensajes enviados", value: totalSent.toLocaleString(), icon: Send, color: "bg-blue-100 text-blue-600" },
            { label: "Tasa de apertura prom.", value: `${avgOpen.toFixed(0)}%`, icon: Eye, color: "bg-green-100 text-green-600" },
            { label: "Conversiones totales", value: totalConv.toLocaleString(), icon: TrendingUp, color: "bg-purple-100 text-purple-600" },
          ].map((k) => (
            <div key={k.label} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-sm transition-shadow">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${k.color}`}>
                <k.icon size={16} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{k.value}</p>
              <p className="text-xs text-gray-500 mt-1">{k.label}</p>
            </div>
          ))}
        </div>

        {/* How it works banner */}
        <div className="bg-gradient-to-r from-amber-50 to-amber-100/60 border border-amber-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={15} className="text-amber-600" />
            <p className="text-sm font-bold text-amber-900">Lanza una campaña completa en 3 pasos</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { n: "01", label: "Seleccionar Producto", sub: "El sistema detecta automáticamente el mejor público para ese producto.", icon: Target },
              { n: "02", label: "Generar Campaña", sub: "Describe el tono y la IA crea 3 versiones: WhatsApp, Email y SMS.", icon: Sparkles },
              { n: "03", label: "Enviar Ahora", sub: "Previsualiza, edita si quieres, y lanza con un solo clic.", icon: Send },
            ].map((s) => (
              <div key={s.n} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-400 flex items-center justify-center shrink-0">
                  <s.icon size={14} className="text-amber-900" />
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-900">{s.n}. {s.label}</p>
                  <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{s.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar campañas..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
            {(["todos", "borrador", "programada", "enviando", "enviada", "fallida"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all ${statusFilter === f ? "bg-amber-400 text-amber-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                {f === "todos" ? "Todas" : STATUS_CFG[f as CampaignStatus]?.label ?? f}
              </button>
            ))}
          </div>
        </div>

        {/* Campaign grid */}
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 bg-white rounded-2xl border border-gray-100 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm font-semibold text-red-600">{loadError}</p>
            <button onClick={() => void load()} className="mt-4 px-4 py-2 text-xs font-bold text-amber-900 bg-amber-400 rounded-xl hover:bg-amber-500 transition-colors">
              Reintentar
            </button>
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((c) => (
              <CampaignCard
                key={c.id}
                c={c}
                onViewClients={() => setClientsModal(c)}
                onManualSeg={() => setManualSeg(c)}
                onEdit={() => setEditing(c)}
                onRelaunch={() => setRelaunching(c)}
                onHistory={() => void handleOpenHistory(c)}
                onDelete={() => setDeleting(c)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <BarChart2 size={24} className="text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-700">Sin campañas</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">Crea tu primera campaña omnicanal ahora</p>
            <button
              onClick={() => setWizardOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-amber-900 bg-amber-400 hover:bg-amber-500 rounded-xl transition-colors"
            >
              <Plus size={14} /> Nueva Campaña
            </button>
          </div>
        )}
      </div>

      {wizardOpen && (
        <CampaignWizard onClose={() => setWizardOpen(false)} onCreated={handleCreated} />
      )}

      {clientsModal && (
        <RecipientsModal
          title="Clientes segmentados"
          subtitle={clientsModal.name}
          campaignId={clientsModal.id}
          onManualSeg={() => {
            setManualSeg(clientsModal);
            setClientsModal(null);
          }}
          onClose={() => setClientsModal(null)}
        />
      )}

      {manualSeg && (
        <ManualSegModal
          campaignId={manualSeg.id}
          campaignName={manualSeg.name}
          onAdded={() => void load()}
          onClose={() => setManualSeg(null)}
        />
      )}

      {editing && (
        <EditCampaignModal
          id={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Eliminar campaña"
          message={`¿Seguro que quieres eliminar "${deleting.name}"? Se quitará de la lista, pero su historial se conserva.`}
          confirmLabel="Eliminar"
          danger
          busy={deleteBusy}
          onConfirm={() => void handleDelete()}
          onClose={() => setDeleting(null)}
        />
      )}

      {relaunching && (
        <ConfirmModal
          title="Relanzar campaña"
          message={`Se re-segmentará el público de "${relaunching.name}" (mismos productos y modo) y se registrará un nuevo envío. El historial anterior se conserva.`}
          confirmLabel="Relanzar"
          busy={relaunchBusy}
          onConfirm={() => void handleRelaunch()}
          onClose={() => setRelaunching(null)}
        />
      )}

      {historyOf && (
        <HistoryModal
          entries={historyEntries}
          loading={historyLoading}
          onClose={() => setHistoryOf(null)}
        />
      )}
    </>
  );
}
