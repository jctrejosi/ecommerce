import { useState, useEffect, useRef } from "react";
import {
  Plus, Search, MessageCircle, Mail, Smartphone, Zap,
  ArrowRight, ChevronLeft, RefreshCw, Send, Clock,
  CheckCircle, Users, TrendingUp, Eye, Edit3, X,
  Sparkles, Target, BarChart2, Calendar, MoreHorizontal,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────── */
interface Product {
  id: string; name: string; price: number; image: string;
  category: string; audience: number; convRate: number;
}

interface GeneratedContent {
  whatsapp: string; email: { subject: string; body: string }; sms: string;
}

type CampaignStatus = "activa" | "programada" | "borrador" | "finalizada";
type Step = 1 | 2 | 3;

/* ─── Mock data ─────────────────────────────────── */
const PRODUCTS: Product[] = [
  { id: "p1", name: "Leche Alquería Entera 1.1L", price: 4350, image: "https://images.unsplash.com/photo-1604095853918-1a1823a63dd5?w=120&h=120&fit=crop&auto=format", category: "Lácteos", audience: 847, convRate: 34 },
  { id: "p2", name: "Pechuga de Pollo Fresca x kg", price: 12900, image: "https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=120&h=120&fit=crop&auto=format", category: "Carnes", audience: 1203, convRate: 41 },
  { id: "p3", name: "Arroz Diana Extra Premium 5kg", price: 22500, image: "https://images.unsplash.com/photo-1557844352-761f2565b576?w=120&h=120&fit=crop&auto=format", category: "Despensa", audience: 632, convRate: 28 },
  { id: "p4", name: "Aguacate Hass Mediano x und", price: 2800, image: "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=120&h=120&fit=crop&auto=format", category: "Frutas y Verduras", audience: 518, convRate: 22 },
  { id: "p5", name: "Detergente Ariel Líquido 3L", price: 28900, image: "https://images.unsplash.com/photo-1563453392212-326f5e854473?w=120&h=120&fit=crop&auto=format", category: "Limpieza", audience: 921, convRate: 37 },
  { id: "p6", name: "Huevos AA Blancos x30", price: 18900, image: "https://images.unsplash.com/photo-1729622493745-03ca9590c64a?w=120&h=120&fit=crop&auto=format", category: "Lácteos", audience: 1089, convRate: 45 },
];

const CAMPAIGNS_MOCK = [
  { id: "C1", name: "Oferta Pollo Fresco — Julio", product: "Pechuga de Pollo x kg", channels: ["wa", "email", "sms"], audience: 1203, status: "activa" as CampaignStatus, sent: 1203, opens: 724, conversions: 93, date: "2025-07-20" },
  { id: "C2", name: "Lácteos de la semana", product: "Leche Alquería 1.1L", channels: ["wa", "sms"], audience: 847, status: "finalizada" as CampaignStatus, sent: 847, opens: 531, conversions: 68, date: "2025-07-14" },
  { id: "C3", name: "Flash Sale Huevos AA", product: "Huevos AA x30", channels: ["email", "sms"], audience: 1089, status: "programada" as CampaignStatus, sent: 0, opens: 0, conversions: 0, date: "2025-07-25" },
  { id: "C4", name: "Campaña Ariel Limpieza", product: "Detergente Ariel 3L", channels: ["wa", "email"], audience: 921, status: "borrador" as CampaignStatus, sent: 0, opens: 0, conversions: 0, date: "" },
];

const STATUS_CFG: Record<CampaignStatus, { label: string; color: string; bg: string; border: string }> = {
  activa:     { label: "Activa",      color: "text-green-700",  bg: "bg-green-50",   border: "border-green-200" },
  programada: { label: "Programada",  color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200" },
  borrador:   { label: "Borrador",    color: "text-gray-600",   bg: "bg-gray-100",   border: "border-gray-200" },
  finalizada: { label: "Finalizada",  color: "text-purple-700", bg: "bg-purple-50",  border: "border-purple-200" },
};

const CHANNEL_CFG = {
  wa:    { label: "WhatsApp", bg: "bg-green-500",  icon: MessageCircle },
  email: { label: "Email",    bg: "bg-blue-500",   icon: Mail },
  sms:   { label: "SMS",      bg: "bg-purple-500", icon: Smartphone },
};

/* ─── Helpers ───────────────────────────────────── */
function fmt(n: number) { return "$" + n.toLocaleString("es-CO"); }

function generateContent(product: Product, prompt: string): GeneratedContent {
  const tone = prompt.toLowerCase();
  const urgente = tone.includes("urgente") || tone.includes("hoy");
  const joven = tone.includes("joven") || tone.includes("🔥");
  const nombre = product.name.split(" ").slice(0, 3).join(" ");
  const desc = joven ? "🔥 ¡Esta es tu oportunidad!" : urgente ? "⚡ ¡Solo por hoy!" : "✨ Oferta especial para ti";

  return {
    whatsapp: `Hola 👋 ¿Ya viste esto?\n\n${desc}\n\n*${nombre}* está disponible ahora en Mercaldas con precio especial: *${fmt(product.price)}*\n\nEs el favorito de nuestros clientes 🛒 ¡No dejes que se agote!\n\n👉 Pedir ahora: mercaldas.com/promo`,
    email: {
      subject: urgente ? `⚡ ¡Solo hoy! ${nombre} al mejor precio` : `${nombre} — Oferta exclusiva para ti`,
      body: `Hola,\n\nSabemos que te gusta ${product.category.toLowerCase()} de calidad. Por eso hoy tenemos algo especial.\n\n${nombre} está disponible en Mercaldas a ${fmt(product.price)} — un precio que no querrás perderte.\n\n¿Por qué comprarlo hoy?\n• Entrega en menos de 2 horas en Medellín\n• Garantía de frescura o te devolvemos tu dinero\n• Miles de clientes ya lo eligieron esta semana\n\nHaz clic abajo y añádelo a tu carrito en segundos.\n\nEl equipo de Mercaldas 💛`,
    },
    sms: `Mercaldas: ${nombre} ${fmt(product.price)}. ${urgente ? "¡Solo hoy!" : "Precio especial."} Pide ya: mrcl.co/p${product.id}`,
  };
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

function EmailPreview({ subject, body, editableBody, onEditSubject, onEditBody }: {
  subject: string; body: string; editableBody: boolean;
  onEditSubject: (s: string) => void; onEditBody: (b: string) => void;
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
      <div className="flex-1 overflow-y-auto">
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
  selectedProduct, onSelect, channels, onToggleChannel, onNext,
}: {
  selectedProduct: Product | null;
  onSelect: (p: Product) => void;
  channels: Record<string, boolean>;
  onToggleChannel: (c: string) => void;
  onNext: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = PRODUCTS.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">¿Qué producto quieres promocionar?</h2>
            <p className="text-sm text-gray-500 mt-1">El sistema analizará el historial de compras y encontrará los mejores clientes para este producto.</p>
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

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map((p) => {
              const active = selectedProduct?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(p)}
                  className={`relative text-left rounded-2xl border-2 p-4 transition-all hover:shadow-md ${active ? "border-amber-400 bg-amber-50 shadow-md" : "border-gray-100 bg-white hover:border-gray-200"}`}
                >
                  {active && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                      <CheckCircle size={12} className="text-white" />
                    </div>
                  )}
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 mb-3">
                    <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                  </div>
                  <p className={`text-sm font-semibold leading-tight mb-1 ${active ? "text-amber-900" : "text-gray-800"}`}>{p.name}</p>
                  <p className="text-xs text-gray-400 mb-2">{fmt(p.price)}</p>
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded-lg w-fit">
                    <Target size={9} />
                    {p.audience.toLocaleString()} clientes · {p.convRate}% conv.
                  </div>
                </button>
              );
            })}
          </div>

          {/* Audience panel */}
          {selectedProduct && (
            <div className="mt-5 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                  <Users size={15} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Público objetivo identificado</p>
                  <p className="text-xs text-gray-400">Análisis basado en historial de compras</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{selectedProduct.audience.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">clientes</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-amber-700">{selectedProduct.convRate}%</p>
                  <p className="text-xs text-amber-600">prob. conversión</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-green-700">~{Math.round(selectedProduct.audience * selectedProduct.convRate / 100)}</p>
                  <p className="text-xs text-green-600">ventas esperadas</p>
                </div>
              </div>

              <div className="text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-3 mb-4 leading-relaxed">
                📊 Clientes que compraron <strong>{selectedProduct.category}</strong> en los últimos 60 días, o visitaron el producto sin completar la compra, o tienen patrones de compra similares.
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Canales de envío</p>
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
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white flex justify-end">
        <button
          onClick={onNext}
          disabled={!selectedProduct || !Object.values(channels).some(Boolean)}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continuar <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Step2({
  product,
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
  onNext,
  onBack,
}: {
  product: Product;
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
  onNext: () => void;
  onBack: () => void;
}) {
  const TONES = [
    { label: "⚡ Urgente", value: "urgente" },
    { label: "🔥 Joven", value: "joven" },
    { label: "💼 Profesional", value: "profesional" },
    { label: "❤️ Emocional", value: "emocional" },
    { label: "✨ Exclusivo", value: "exclusivo" },
  ];

  const addTone = (t: string) => {
    setPrompt(prompt ? prompt + ", " + t : t);
  };

  const activeChannelCount = Object.values(channels).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {!generated ? (
          <div className="p-6 max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Describe tu campaña</h2>
            <p className="text-sm text-gray-500 mb-6">La IA generará los mensajes para <strong>{activeChannelCount} canal{activeChannelCount !== 1 ? "es" : ""}</strong> automáticamente.</p>

            {/* Product reminder */}
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-5">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-white shrink-0">
                <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-900">{product.name}</p>
                <p className="text-xs text-amber-700">{product.audience.toLocaleString()} clientes · {fmt(product.price)}</p>
              </div>
            </div>

            {/* Tones */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-600 mb-2">Tono rápido</p>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => addTone(t.value)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-all"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Describe el objetivo y tono</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Ej: lanza un descuento por lanzamiento con un tono joven y urgente, enfocado en familias jóvenes de Medellín..."
                className="w-full px-4 py-3 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none placeholder-gray-300"
              />
            </div>

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
                    <button onClick={() => onToggleEdit("email")} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${editableEmail ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                      <Edit3 size={9} /> {editableEmail ? "Listo" : "Editar"}
                    </button>
                  </div>
                  <div className="flex-1 h-80">
                    <EmailPreview
                      subject={content.email.subject}
                      body={content.email.body}
                      editableBody={editableEmail}
                      onEditSubject={onEditEmailSubject}
                      onEditBody={onEditEmailBody}
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
  product,
  channels,
  onSend,
  onBack,
  sent,
}: {
  product: Product;
  channels: Record<string, boolean>;
  onSend: () => void;
  onBack: () => void;
  sent: boolean;
}) {
  const [scheduled, setScheduled] = useState(false);
  const activeChannels = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);
  const totalReach = product.audience;

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
            { label: "Conversiones est.", value: Math.round(totalReach * product.convRate / 100).toLocaleString() },
            { label: "ROI esperado", value: `${(product.convRate * 4.2).toFixed(0)}%` },
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
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                  <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{product.name}</p>
                  <p className="text-xs text-gray-400">{fmt(product.price)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-sm text-gray-600">Público objetivo</span>
                <span className="text-sm font-bold text-gray-900">{totalReach.toLocaleString()} clientes</span>
              </div>
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
                <span className="text-sm font-bold text-green-600">~{Math.round(totalReach * product.convRate / 100)}</span>
              </div>
            </div>
          </div>

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
        <button
          onClick={onSend}
          className="flex items-center gap-2.5 px-6 py-3 text-sm font-bold bg-amber-400 text-amber-900 hover:bg-amber-500 rounded-xl transition-all shadow-md hover:shadow-lg"
        >
          <Send size={15} /> {scheduled ? "Programar Campaña" : "Enviar Ahora"}
        </button>
      </div>
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
function CampaignWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (c: typeof CAMPAIGNS_MOCK[0]) => void }) {
  const [step, setStep] = useState<Step>(1);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [channels, setChannels] = useState<Record<string, boolean>>({ wa: true, email: true, sms: true });
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [editableWa, setEditableWa] = useState(false);
  const [editableEmail, setEditableEmail] = useState(false);
  const [editableSms, setEditableSms] = useState(false);
  const [sent, setSent] = useState(false);

  const toggleChannel = (c: string) => setChannels((prev) => ({ ...prev, [c]: !prev[c] }));

  const handleGenerate = () => {
    if (!selectedProduct) return;
    setGenerating(true);
    setGenerated(false);
    setTimeout(() => {
      setContent(generateContent(selectedProduct, prompt));
      setGenerating(false);
      setGenerated(true);
    }, 2200);
  };

  const handleSend = () => {
    setSent(true);
    setTimeout(() => {
      if (selectedProduct) {
        const newCampaign = {
          id: "C" + Date.now(),
          name: prompt.slice(0, 32) || "Nueva campaña",
          product: selectedProduct.name,
          channels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
          audience: selectedProduct.audience,
          status: "activa" as CampaignStatus,
          sent: selectedProduct.audience,
          opens: Math.round(selectedProduct.audience * 0.6),
          conversions: Math.round(selectedProduct.audience * selectedProduct.convRate / 100),
          date: new Date().toISOString().split("T")[0],
        };
        onCreated(newCampaign);
      }
      setTimeout(onClose, 1800);
    }, 300);
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
            selectedProduct={selectedProduct}
            onSelect={setSelectedProduct}
            channels={channels}
            onToggleChannel={toggleChannel}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && selectedProduct && (
          <Step2
            product={selectedProduct}
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
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && selectedProduct && (
          <Step3
            product={selectedProduct}
            channels={channels}
            onSend={handleSend}
            onBack={() => setStep(2)}
            sent={sent}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Campaign list ─────────────────────────────── */
function CampaignCard({ c }: { c: typeof CAMPAIGNS_MOCK[0] }) {
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
        <span className="text-xs text-gray-400 ml-1">{c.audience.toLocaleString()} contactos</span>
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
  const [campaigns, setCampaigns] = useState(CAMPAIGNS_MOCK);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "todos">("todos");
  const [search, setSearch] = useState("");

  const handleCreated = (c: typeof CAMPAIGNS_MOCK[0]) => {
    setCampaigns((prev) => [c, ...prev]);
  };

  const filtered = campaigns.filter((c) => {
    const matchStatus = statusFilter === "todos" || c.status === statusFilter;
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.product.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const activas = campaigns.filter((c) => c.status === "activa").length;
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
            {(["todos", "activa", "programada", "borrador", "finalizada"] as const).map((f) => (
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
        {filtered.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((c) => <CampaignCard key={c.id} c={c} />)}
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
    </>
  );
}
