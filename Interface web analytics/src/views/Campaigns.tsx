import { useState, useEffect, useRef } from "react";
import {
  Plus, Search, MessageCircle, Mail, Smartphone, Zap,
  ArrowRight, ChevronLeft, RefreshCw, Send, Clock,
  CheckCircle, Users, TrendingUp, Eye, Edit3, X,
  Sparkles, Target, BarChart2, Calendar, MoreHorizontal,
  Palette, ShoppingBag,
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
  type Recipient,
  type SegmentPreviewResult,
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
}: {
  selectedProducts: Product[];
  onToggle: (p: Product) => void;
  onClear: () => void;
  channels: Record<string, boolean>;
  onToggleChannel: (c: string) => void;
  onNext: () => void;
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
            <div className="text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-3 mt-4 leading-relaxed">
              🔎 La segmentación inteligente de clientes se conectará próximamente. Por ahora la campaña se dirigirá a una audiencia estimada de <strong>{ESTIMATED_AUDIENCE.toLocaleString()} clientes</strong> (recomendación aleatoria).
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
}) {
  const activeChannelCount = Object.values(channels).filter(Boolean).length;

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
            {generating ? (
              <div className="flex flex-col items-center gap-4 py-10">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-amber-200 animate-ping" />
                  <div className="w-16 h-16 rounded-full bg-amber-400 flex items-center justify-center">
                    <Sparkles size={22} className="text-white" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-700">La IA está creando tu campaña…</p>
                  <p className="text-xs text-gray-400 mt-1">Analizando tono, público y canal</p>
                </div>
              </div>
            ) : (
              <button
                onClick={onGenerate}
                disabled={!prompt.trim()}
                className="w-full flex items-center justify-center gap-3 py-3.5 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-2xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
              >
                <Sparkles size={16} />
                Generar Campaña
              </button>
            )}
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

            <div className={`grid gap-4 ${activeChannelCount === 3 ? "grid-cols-3" : activeChannelCount === 2 ? "grid-cols-2" : "grid-cols-1 max-w-sm mx-auto"}`}>
              {channels.wa && content && (
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-green-500 flex items-center justify-center">
                        <MessageCircle size={12} className="text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-700">WhatsApp</span>
                    </div>
                    <button onClick={() => onToggleEdit("wa")} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${editableWa ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                      <Edit3 size={9} /> {editableWa ? "Listo" : "Editar"}
                    </button>
                  </div>
                  <div className="flex-1 h-80">
                    <WhatsAppPreview text={content.whatsapp} editable={editableWa} onEdit={onEditWa} />
                  </div>
                </div>
              )}

              {channels.email && content && (
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-blue-500 flex items-center justify-center">
                        <Mail size={12} className="text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-700">Email</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={onOpenDesigner} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">
                        <Palette size={9} /> Diseñar
                      </button>
                      <button onClick={() => onToggleEdit("email")} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${editableEmail ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                        <Edit3 size={9} /> {editableEmail ? "Listo" : "Editar"}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 h-80">
                    <EmailPreview
                      subject={content.email.subject}
                      body={content.email.body}
                      editableBody={editableEmail}
                      onEditSubject={onEditEmailSubject}
                      onEditBody={onEditEmailBody}
                      html={emailHtml}
                    />
                  </div>
                </div>
              )}

              {channels.sms && content && (
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-purple-500 flex items-center justify-center">
                        <Smartphone size={12} className="text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-700">SMS</span>
                    </div>
                    <button onClick={() => onToggleEdit("sms")} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${editableSms ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                      <Edit3 size={9} /> {editableSms ? "Listo" : "Editar"}
                    </button>
                  </div>
                  <div className="flex-1 h-80">
                    <SmsPreview text={content.sms} editable={editableSms} onEdit={onEditSms} />
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
}: {
  products: Product[];
  channels: Record<string, boolean>;
  onSend: () => void;
  onBack: () => void;
  sent: boolean;
  sending: boolean;
  sendError: string | null;
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
    const es = campaignsService.segmentPreviewStream(ids, {
      onStage: (s) => setSegStage(s),
      onResult: (r) => {
        setSeg(r);
        setSegLoading(false);
      },
      onError: (msg) => {
        setSegError(msg);
        setSegLoading(false);
      },
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalReach = seg?.segmentTotal ?? ESTIMATED_AUDIENCE;

  if (sent) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
        <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-6 animate-bounce">
          <CheckCircle size={44} className="text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Campaña lanzada! 🎉</h2>
        <p className="text-gray-500 mb-1">
          <strong className="text-gray-800">{totalReach.toLocaleString()} mensajes</strong> están en cola de envío.
        </p>
        <p className="text-sm text-gray-400 mb-8">
          Canales: {activeChannels.map((c) => CHANNEL_CFG[c as keyof typeof CHANNEL_CFG].label).join(", ")}
        </p>
        <div className="grid grid-cols-3 gap-4 w-full max-w-sm">
          {[
            { label: "Estimados abiertos", value: Math.round(totalReach * 0.6).toLocaleString() },
            { label: "Conversiones est.", value: Math.round(totalReach * ESTIMATED_CONV_RATE / 100).toLocaleString() },
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
                    <span className="text-sm font-bold text-gray-900">{totalReach.toLocaleString()} clientes</span>
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
                <p className="text-[11px] text-gray-400">
                  Segmento {seg.segment} · {seg.buyers.toLocaleString()} clientes con afinidad a los productos · mostrando {seg.total.toLocaleString()} de {seg.segmentTotal.toLocaleString()}
                </p>
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
                <span className="text-sm font-bold text-green-600">~{Math.round(totalReach * ESTIMATED_CONV_RATE / 100)}</span>
              </div>
            </div>
          </div>

          {clientsOpen && seg && (
            <RecipientsModal
              title="Clientes segmentados"
              subtitle={`Segmento ${seg.segment} — mostrando ${seg.total.toLocaleString()} de ${seg.segmentTotal.toLocaleString()} clientes que cumplen el estándar`}
              recipients={seg.recipients}
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

  const toggleChannel = (c: string) => setChannels((prev) => ({ ...prev, [c]: !prev[c] }));

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
      setContent({
        whatsapp: res.whatsapp ?? "",
        email: {
          subject: email?.asunto ?? "",
          body: email?.bloques?.length ? blocksToText(email.bloques) : "",
        },
        sms: res.sms ?? "",
      });
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
        channels: active.map((k) => CHANNEL_TO_API[k]),
        messages,
      });

      // Recomendación de clientes (segmentación vía clustering-api cuando
      // se indique segmento; por ahora sin segmento → aleatorio).
      const gen = await campaignsService.generateRecipients(created.id, 500).catch(() => null);

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

function RecipientsModal({
  title,
  subtitle,
  recipients: preset,
  campaignId,
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
  onClose: () => void;
}) {
  const [recipients, setRecipients] = useState<SegClientRow[]>([]);
  const [loading, setLoading] = useState(campaignId != null && preset == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const initials = (name: string | null) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Users size={18} className="text-amber-600" /> {title}
            </h3>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-gray-100 shrink-0 flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, email o teléfono…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
            />
          </div>
          <span className="text-xs text-gray-400 font-semibold whitespace-nowrap">
            {filtered.length.toLocaleString()} de {recipients.length.toLocaleString()}
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
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
            <ul className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(r.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{r.name ?? "Sin nombre"}</p>
                    <p className="text-xs text-gray-400 truncate">{r.email ?? "Sin email"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">{r.phone ?? "—"}</p>
                    {(r.propensity != null || r.uplift != null) && (
                      <p className="text-[10px] font-semibold text-gray-400">
                        {r.propensity != null ? `P ${Math.round(r.propensity * 100)}%` : ""}
                        {r.uplift != null ? ` · U ${r.uplift.toFixed(3)}` : ""}
                      </p>
                    )}
                    {r.status && <p className="text-[10px] font-bold text-gray-400 uppercase">{r.status}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Campaign list ─────────────────────────────── */
function CampaignCard({ c, onViewClients }: { c: CampaignCardData; onViewClients: () => void }) {
  const cfg = STATUS_CFG[c.status];
  const openRate = c.sent > 0 ? Math.round((c.opens / c.sent) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 pr-3">
          <p className="font-bold text-gray-900 truncate">{c.name}</p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{c.product}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
            {cfg.label}
          </span>
          <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

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
            {filtered.map((c) => <CampaignCard key={c.id} c={c} onViewClients={() => setClientsModal(c)} />)}
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
          onClose={() => setClientsModal(null)}
        />
      )}
    </>
  );
}
