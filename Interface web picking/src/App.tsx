import { useState, useRef, useEffect } from "react";
import WarehouseMapEditor from "./WarehouseMapEditor";
import PickingMap from "./PickingMap";
import { PlacedShelf, INITIAL_PLACED } from "./mapData";
import {
  pickingService,
  ApiError,
  type PickingOrder,
  type PickingItem,
  type ScanResult,
} from "./services/picking.service";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import logo from "./assets/logo.bmp";

// ─── Types ───────────────────────────────────────────────────────────────────

type OrderStatus = "nuevo" | "preparando" | "completado";

interface Product {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  scannedQty: number;
  barcode: string;
  plu?: string;
  location: string;
  aisle: string;
  shelf: string;
  level: string;
  imageHue: number;
  /** id de la variante en el backend (para buscar su ubicación en el mapa). */
  variantId: number | null;
  /** id de la estantería donde está el producto (rellenado al abrir el mapa). */
  shelfId: string | null;
  /** fila dentro de la estantería (rellenada al abrir el mapa). */
  rowNumber: number | null;
  /** ubicación real (estantería + fila) tal como viene del backend. */
  shelfCode: string | null;
  shelfName: string | null;
  /** url de la imagen del producto (si tiene). */
  image: string | null;
}

interface Order {
  id: string;
  code: string;
  customer: string;
  status: OrderStatus;
  total: number;
  createdMinutesAgo: number;
  reviewed: boolean;
  branchId: number;
  items: Product[];
  itemsCount?: number;
  totalPieces?: number;
  scannedPieces?: number;
}

// ─── API mappers (backend → UI) ───────────────────────────────────────────────

function hueFrom(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function apiItemToProduct(i: PickingItem): Product {
  return {
    id: String(i.id),
    name: i.name,
    sku: i.sku ?? "",
    quantity: i.quantity,
    scannedQty: i.pickedQty,
    barcode: i.barcode ?? "",
    plu: i.plu ?? undefined,
    location: "",
    aisle: "",
    shelf: "",
    level: "",
    imageHue: hueFrom(i.sku ?? i.name),
    variantId: i.productVariantId ?? null,
    shelfId: null,
    rowNumber: i.rowNumber ?? null,
    shelfCode: i.shelfCode ?? null,
    shelfName: i.shelfName ?? null,
    image: i.image ?? null,
  };
}

function apiOrderToOrder(o: PickingOrder): Order {
  const status: OrderStatus =
    o.status === "delivered" ? "completado" : o.status === "preparing" ? "preparando" : "nuevo";
  const items = (o.items ?? []).map(apiItemToProduct);
  const minutes = o.createdAt
    ? Math.max(1, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000))
    : 1;
  return {
    id: String(o.id),
    code: o.referenceCode,
    customer: o.customerName,
    status,
    total: o.grandTotal,
    createdMinutesAgo: minutes,
    reviewed: o.reviewed,
    branchId: o.branchId,
    items,
  };
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_ORDERS: Order[] = [
  {
    id: "1",
    code: "MC-3841",
    customer: "Valentina Ríos",
    status: "nuevo",
    total: 87500,
    createdMinutesAgo: 3,
    reviewed: false,
    items: [
      { id: "p1", name: "Leche Entera Colanta 1L", sku: "COL-001", quantity: 2, scannedQty: 0, barcode: "7702001001234", plu: "4022", location: "A1 · Estante 1 · Nivel 2", aisle: "A1", shelf: "Estante 1", level: "Nivel 2", imageHue: 200 },
      { id: "p2", name: "Pan Tajado Bimbo 500g", sku: "BIM-023", quantity: 1, scannedQty: 0, barcode: "7501002001023", location: "B2 · Estante 3 · Nivel 1", aisle: "B2", shelf: "Estante 3", level: "Nivel 1", imageHue: 40 },
      { id: "p3", name: "Arroz Diana Blanco 1kg", sku: "DIA-045", quantity: 3, scannedQty: 0, barcode: "7702903045001", plu: "1031", location: "C1 · Estante 1 · Nivel 3", aisle: "C1", shelf: "Estante 1", level: "Nivel 3", imageHue: 60 },
      { id: "p4", name: "Aceite Girasol Gourmet 900ml", sku: "GRM-102", quantity: 1, scannedQty: 0, barcode: "7706101020011", location: "C2 · Estante 2 · Nivel 2", aisle: "C2", shelf: "Estante 2", level: "Nivel 2", imageHue: 45 },
      { id: "p5", name: "Detergente Ariel 1kg", sku: "ARI-201", quantity: 2, scannedQty: 0, barcode: "5012345678901", location: "D3 · Estante 1 · Nivel 1", aisle: "D3", shelf: "Estante 1", level: "Nivel 1", imageHue: 220 },
      { id: "p6", name: "Yogurt Alpina Fresa 200g", sku: "ALP-033", quantity: 4, scannedQty: 0, barcode: "7702001033210", plu: "4055", location: "A2 · Estante 2 · Nivel 1", aisle: "A2", shelf: "Estante 2", level: "Nivel 1", imageHue: 340 },
      { id: "p7", name: "Jabón Protex 125g x3", sku: "PRO-078", quantity: 1, scannedQty: 0, barcode: "6920354805553", location: "D1 · Estante 3 · Nivel 2", aisle: "D1", shelf: "Estante 3", level: "Nivel 2", imageHue: 160 },
      { id: "p8", name: "Cereal Nesquik 350g", sku: "NES-055", quantity: 2, scannedQty: 0, barcode: "7613034626080", location: "B1 · Estante 1 · Nivel 3", aisle: "B1", shelf: "Estante 1", level: "Nivel 3", imageHue: 30 },
    ],
  },
  {
    id: "2",
    code: "MC-3839",
    customer: "Carlos Mendoza",
    status: "preparando",
    total: 124300,
    createdMinutesAgo: 12,
    reviewed: true,
    items: [
      { id: "p9", name: "Queso Campesino Colanta 500g", sku: "COL-201", quantity: 1, scannedQty: 1, barcode: "7702001201234", plu: "5010", location: "A1 · Estante 2 · Nivel 1", aisle: "A1", shelf: "Estante 2", level: "Nivel 1", imageHue: 55 },
      { id: "p10", name: "Pollo Entero Bandeja 1.5kg", sku: "POL-001", quantity: 2, scannedQty: 2, barcode: "7701289001500", location: "A3 · Estante 1 · Nivel 1", aisle: "A3", shelf: "Estante 1", level: "Nivel 1", imageHue: 25 },
      { id: "p11", name: "Tomate Chonto kg", sku: "VEG-012", quantity: 2, scannedQty: 0, barcode: "2345678901234", plu: "3001", location: "A4 · Estante 1 · Nivel 1", aisle: "A4", shelf: "Estante 1", level: "Nivel 1", imageHue: 5 },
    ],
  },
  {
    id: "3",
    code: "MC-3835",
    customer: "María Fernanda Gómez",
    status: "completado",
    total: 56200,
    createdMinutesAgo: 34,
    reviewed: true,
    items: [],
  },
  {
    id: "4",
    code: "MC-3842",
    customer: "Andrés Felipe Torres",
    status: "nuevo",
    total: 201800,
    createdMinutesAgo: 1,
    reviewed: false,
    items: [
      { id: "p12", name: "Atún Van Camps 170g x3", sku: "VAN-099", quantity: 2, scannedQty: 0, barcode: "0041000001020", location: "B3 · Estante 2 · Nivel 2", aisle: "B3", shelf: "Estante 2", level: "Nivel 2", imageHue: 190 },
      { id: "p13", name: "Agua Cristal 600ml x6", sku: "CRI-001", quantity: 1, scannedQty: 0, barcode: "7702098000610", location: "E1 · Estante 1 · Nivel 1", aisle: "E1", shelf: "Estante 1", level: "Nivel 1", imageHue: 210 },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(minutes: number): string {
  if (minutes < 1) return "hace un momento";
  if (minutes === 1) return "hace 1 min";
  if (minutes < 60) return `hace ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `hace ${h}h`;
}

function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(amount);
}

function StatusChip({ status }: { status: OrderStatus }) {
  const map = {
    nuevo: { label: "Nuevo", cls: "bg-amber-400/20 text-amber-400 border border-amber-400/30" },
    preparando: { label: "Preparando", cls: "bg-blue-500/20 text-blue-400 border border-blue-500/30" },
    completado: { label: "Completado", cls: "bg-green-500/20 text-green-400 border border-green-500/30" },
  };
  const s = map[status];
  return (
    <span className={`text-[11px] font-700 px-2 py-0.5 rounded-full uppercase tracking-wider ${s.cls}`}>
      {s.label}
    </span>
  );
}

function ProductPlaceholder({ hue, size = 48 }: { hue: number; size?: number }) {
  return (
    <div
      className="rounded-lg flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue}, 55%, 14%)`,
        border: `1px solid hsl(${hue}, 55%, 22%)`,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="7" width="20" height="14" rx="2" stroke={`hsl(${hue}, 70%, 55%)`} strokeWidth="1.5" />
        <path d="M16 7V5a4 4 0 0 0-8 0v2" stroke={`hsl(${hue}, 70%, 55%)`} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// Imagen del producto con fallback al placeholder si no hay imagen o falla
function ProductImage({ product, size = 48 }: { product: Product; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!product.image || failed) {
    return <ProductPlaceholder hue={product.imageHue} size={size} />;
  }
  return (
    <img
      src={product.image}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="rounded-lg object-cover shrink-0"
      style={{ width: size, height: size, background: "#161618", border: "1px solid rgba(255,255,255,0.08)" }}
    />
  );
}

// ─── Screen: Order List ───────────────────────────────────────────────────────

type FilterTab = "nuevo" | "preparando" | "completado";

function OrderListScreen({
  orders,
  onSelectOrder,
  onMarkReviewed,
  toast,
  queueError,
  loading,
  onRetry,
  pickerName,
  onOpenPicker,
}: {
  orders: Order[];
  onSelectOrder: (o: Order) => void;
  onMarkReviewed: (id: string) => void;
  toast: { code: string } | null;
  queueError: string | null;
  loading: boolean;
  onRetry: () => void;
  pickerName: string | null;
  onOpenPicker: () => void;
}) {
  const [filter, setFilter] = useState<FilterTab>("nuevo");

  const filtered = orders
    .filter(o => o.status === filter)
    .sort((a, b) => {
      if (!a.reviewed && b.reviewed) return -1;
      if (a.reviewed && !b.reviewed) return 1;
      return a.createdMinutesAgo - b.createdMinutesAgo;
    });

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "nuevo", label: "Nuevos" },
    { key: "preparando", label: "Preparando" },
    { key: "completado", label: "Completados" },
  ];

  return (
    <div className="h-full bg-[#0C0C0D] flex flex-col overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="absolute top-0 left-0 right-0 z-50 animate-slide-down">
          <div className="mx-4 mt-3 bg-amber-400 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg">
            <div className="w-8 h-8 rounded-full bg-[#0C0C0D]/20 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#0C0C0D"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[#0C0C0D] font-700 text-sm">Nuevo pedido {toast.code}</p>
              <p className="text-[#0C0C0D]/70 text-xs">Recibido ahora · Toca para revisar</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-start gap-1">
            <img src={logo} alt="Mercaldas" className="h-8 w-auto object-contain" />
            <h1 className="text-white text-2xl font-800 tracking-tight">Picking</h1>
            <p className="text-white/40 text-xs font-500">Sucursal Centro · Turno mañana</p>
          </div>
          <button
            onClick={onOpenPicker}
            className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full pl-3 pr-2 py-1.5 active:bg-white/10 transition-colors"
          >
            <span className="w-6 h-6 rounded-full bg-amber-400 text-[#0C0C0D] flex items-center justify-center text-[10px] font-800">
              {(pickerName ?? "?")[0]?.toUpperCase()}
            </span>
            <span className="text-white/70 text-xs font-700 max-w-[110px] truncate">{pickerName ?? "Elige usuario"}</span>
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-5 mb-4">
        <div className="flex gap-2 flex-wrap">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-700 transition-all ${
                filter === t.key
                  ? "bg-amber-400 text-[#0C0C0D]"
                  : "bg-white/5 text-white/50 border border-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-3">
        {queueError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
            <p className="flex-1 text-red-400 text-xs font-600">{queueError}</p>
            <button onClick={onRetry} className="text-xs font-800 text-red-400 underline">
              Reintentar
            </button>
          </div>
        )}
        {loading && orders.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white/5 rounded-2xl p-4 animate-pulse">
                <div className="w-24 h-5 bg-white/10 rounded mb-3" />
                <div className="w-40 h-3.5 bg-white/8 rounded mb-3" />
                <div className="w-28 h-3.5 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          filtered.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              onTap={() => onSelectOrder(order)}
              onMarkReviewed={() => onMarkReviewed(order.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OrderCard({ order, onTap, onMarkReviewed }: { order: Order; onTap: () => void; onMarkReviewed: () => void }) {
  const isNew = order.status === "nuevo" && !order.reviewed;

  return (
    <div
      onClick={onTap}
      className={`rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-all ${
        isNew
          ? "bg-amber-400/8 border border-amber-400/30"
          : "bg-white/[0.04] border border-white/8"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isNew && (
            <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
          <span className="text-white font-800 text-base tracking-tight">{order.code}</span>
          {isNew && (
            <span className="shrink-0 text-[10px] font-800 uppercase tracking-wider bg-amber-400 text-[#0C0C0D] px-2 py-0.5 rounded-full">
              Nuevo
            </span>
          )}
        </div>
        <StatusChip status={order.status} />
      </div>

      <p className="text-white/70 text-sm font-500 mb-3 truncate">{order.customer}</p>

      <div className="flex items-center justify-between">
        <span className="text-white/40 text-xs font-500">{formatTime(order.createdMinutesAgo)}</span>
        <span className="text-white font-700 text-sm">{formatCOP(order.total)}</span>
      </div>

      {isNew && (
        <button
          onClick={e => { e.stopPropagation(); onMarkReviewed(); }}
          className="mt-3 w-full py-2 rounded-xl border border-amber-400/40 text-amber-400 text-xs font-700 active:bg-amber-400/10 transition-colors"
        >
          Marcar revisado
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center pt-20 text-center px-8">
      <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M9 12l2 2 4-4M7 2h10l5 5v15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.3"/>
        </svg>
      </div>
      <p className="text-white/50 font-700 text-base">No hay pedidos pendientes</p>
      <p className="text-white/25 text-sm font-500 mt-1">Cuando lleguen pedidos aparecerán aquí</p>
    </div>
  );
}

// ─── Screen: Order Detail ─────────────────────────────────────────────────────

function OrderDetailScreen({
  order,
  onBack,
  onScanProduct,
  onViewMap,
}: {
  order: Order;
  onBack: () => void;
  onScanProduct: (product: Product) => void;
  onViewMap: () => void;
}) {
  const scanned = order.items.filter(i => i.scannedQty >= i.quantity).length;
  const total = order.items.length;
  const progress = total > 0 ? scanned / total : 0;

  return (
    <div className="h-full bg-[#0C0C0D] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center active:bg-white/10 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-800 text-xl tracking-tight">{order.code}</h2>
            <p className="text-white/40 text-xs font-500 truncate">{order.customer}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-white font-700 text-sm">{formatCOP(order.total)}</p>
            <p className="text-white/40 text-xs font-500">Sucursal Centro</p>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white/5 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/60 text-xs font-600">Progreso del picking</span>
            <span className="text-white font-800 text-sm">{scanned}/{total} productos</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2">
        <p className="text-white/30 text-xs font-700 uppercase tracking-wider mb-3">
          Ordenado por ubicación
        </p>
        {order.items.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            onTap={() => product.scannedQty < product.quantity && onScanProduct(product)}
          />
        ))}
      </div>

      {/* Bottom CTA */}
      <div className="px-5 pb-8 pt-2 shrink-0 space-y-2">
        <button
          onClick={onViewMap}
          className="w-full bg-white/5 border border-white/10 text-white font-700 text-sm rounded-2xl py-3 active:bg-white/10 transition-all flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="white" strokeWidth="1.6" strokeOpacity="0.7" />
            <rect x="14" y="3" width="7" height="7" rx="1.2" stroke="white" strokeWidth="1.6" strokeOpacity="0.7" />
            <rect x="3" y="14" width="7" height="7" rx="1.2" stroke="white" strokeWidth="1.6" strokeOpacity="0.7" />
            <rect x="14" y="14" width="7" height="7" rx="1.2" stroke="white" strokeWidth="1.6" strokeOpacity="0.7" />
          </svg>
          Ver mapa de bodega
        </button>
        {scanned === total && total > 0 && (
          <button
            onClick={() => onScanProduct(order.items[0])}
            className="w-full bg-green-500 text-white font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all"
          >
            Ver checklist final
          </button>
        )}
      </div>
    </div>
  );
}

function ProductRow({ product, onTap }: { product: Product; onTap: () => void }) {
  const done = product.scannedQty >= product.quantity;

  return (
    <div
      onClick={onTap}
      className={`rounded-2xl p-3.5 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-all ${
        done
          ? "bg-green-500/8 border border-green-500/20 opacity-60"
          : "bg-white/[0.04] border border-white/8 active:bg-white/8"
      }`}
    >
      <ProductImage product={product} size={48} />

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-700 leading-tight mb-1 ${done ? "text-white/50 line-through" : "text-white"}`}>
          {product.name}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-white/30 text-[11px] font-500">{product.sku}</span>
          {product.plu && (
            <span className="text-[10px] font-700 bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1.5 py-0.5 rounded-full">
              PLU {product.plu}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className={`text-[11px] font-700 px-2 py-0.5 rounded-lg border ${product.shelfCode ? "bg-green-500/10 text-green-400 border-green-500/25" : "bg-amber-400/10 text-amber-400 border-amber-400/20"}`}>
            {product.shelfCode ? `${product.shelfCode}${product.rowNumber ? ` · Fila ${product.rowNumber}` : ""}` : "Sin ubicación"}
          </span>
          <span className="text-[11px] font-500 text-white/30">{product.barcode}</span>
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {done ? (
          <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full border-2 border-white/20" />
        )}
        <span className={`text-xs font-800 ${done ? "text-green-400" : "text-white"}`}>
          ×{product.quantity}
        </span>
      </div>
    </div>
  );
}

// ─── Screen: Scanner ──────────────────────────────────────────────────────────

type ScanState = "idle" | "success" | "error";

function ScannerScreen({
  product,
  order,
  onScanSuccess,
  onBack,
  onViewMap,
}: {
  product: Product;
  order: Order;
  onScanSuccess: (result: ScanResult) => void;
  onBack: () => void;
  onViewMap: () => void;
}) {
  const [input, setInput] = useState("");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [wrongCode, setWrongCode] = useState("");
  const [qty, setQty] = useState(product.quantity - product.scannedQty);
  const [animKey, setAnimKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const scanRef = useRef<(code: string) => void>(() => {});

  async function handleScan(code: string) {
    const trimmed = code.trim();
    if (!trimmed || scanning || processingRef.current) return;
    setScanning(true);
    processingRef.current = true;
    try {
      const result = await pickingService.scan(Number(order.id), trimmed);
      setScanState("success");
      setAnimKey(k => k + 1);
      setInput("");
      if (navigator.vibrate) navigator.vibrate(60);
      setTimeout(() => {
        if (result.remaining <= 0) {
          processingRef.current = false;
          onScanSuccess(result);
        } else {
          setQty(q => q - 1);
          setScanState("idle");
          processingRef.current = false;
        }
      }, 800);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const expected = err?.payload?.expected?.length
        ? err.payload.expected
        : [product.barcode, product.plu].filter(Boolean);
      setWrongCode(trimmed);
      setErrorMsg(`Escaneaste: ${trimmed}. Se esperaba: ${expected[0] ?? "otro código"}`);
      setScanState("error");
      setAnimKey(k => k + 1);
      setInput("");
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      setTimeout(() => {
        setScanState("idle");
        processingRef.current = false;
      }, 1800);
    } finally {
      setScanning(false);
    }
  }

  // La cámara siempre llama a la versión más reciente de handleScan
  scanRef.current = handleScan;

  // Iniciar/detener la cámara real (html5-qrcode)
  useEffect(() => {
    let qr: Html5Qrcode | null = null;
    let active = true;
    let videoEl: HTMLVideoElement | null = null;

    // El <video> que crea html5-qrcode usa el ancho del contenedor y su alto
    // natural (sin object-fit). Ajustamos el contenedor al aspect ratio real
    // del stream para que el cuadro de captura (sombreado + esquinas de la
    // librería) quede exactamente sobre el video: lo que se ve = lo que se
    // escanea.
    const fitViewfinder = () => {
      const container = document.getElementById("picking-qr-reader");
      if (!container || !videoEl) return;
      videoEl.style.width = `${container.clientWidth}px`;
      if (videoEl.videoWidth && videoEl.videoHeight) {
        container.style.height =
          `${Math.round((container.clientWidth * videoEl.videoHeight) / videoEl.videoWidth)}px`;
      }
    };

    const stopCamera = async () => {
      if (videoEl) {
        videoEl.removeEventListener("loadedmetadata", fitViewfinder);
        videoEl = null;
      }
      if (qr) {
        try { await qr.stop(); } catch { /* noop */ }
        try { await qr.clear(); } catch { /* noop */ }
        qr = null;
      }
    };

    const startCamera = async () => {
      if (!active) return;
      setCameraError(null);
      try {
        await stopCamera();
        qr = new Html5Qrcode("picking-qr-reader", {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
          ],
        });
        const cameras = await Html5Qrcode.getCameras();
        let target: string | { facingMode: string } = { facingMode: "environment" };
        if (cameras && cameras.length > 0) {
          const back = cameras.find(c => /back|rear|environment/i.test(c.label));
          target = back ? back.id : cameras[0].id;
        }
        if (!active) return;
        await qr.start(
          target,
          {
            fps: 10,
            qrbox: { width: 280, height: 110 },
          },
          (decodedText) => { void scanRef.current(decodedText); },
          () => { /* ignorar frames sin código */ }
        );
        videoEl = document.getElementById("picking-qr-reader")?.querySelector<HTMLVideoElement>("video") ?? null;
        videoEl?.addEventListener("loadedmetadata", fitViewfinder);
        fitViewfinder();
      } catch (e) {
        if (active) {
          setCameraError(
            e instanceof Error && /permission|denied/i.test(e.message)
              ? "Permiso de cámara denegado"
              : "No se pudo acceder a la cámara"
          );
        }
      }
    };

    // Al volver de segundo plano (el móvil pausa/congela el stream), reiniciar
    // la cámara para recuperar el foco.
    const onVisibility = () => {
      if (!document.hidden) void startCamera();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", fitViewfinder);

    void startCamera();

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", fitViewfinder);
      void stopCamera();
    };
  }, []);

  // Al cambiar de producto, reiniciar estados (la cámara sigue activa)
  useEffect(() => {
    setScanState("idle");
    setInput("");
    setWrongCode("");
    setErrorMsg("");
    setQty(product.quantity - product.scannedQty);
    processingRef.current = false;
  }, [product.id]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleScan(input);
  }

  const bgClass =
    scanState === "success"
      ? "animate-flash-green"
      : scanState === "error"
      ? "animate-flash-red"
      : "";

  return (
    <div className={`h-full bg-[#0C0C0D] flex flex-col overflow-hidden relative ${bgClass}`}>
      {/* Cámara real */}
      <div className="relative bg-[#111112] flex-1 flex items-center justify-center overflow-hidden">
        {/* Contenedor de la cámara: html5-qrcode inyecta aquí el <video> y el
            cuadro de captura (sombreado + esquinas blancas). El alto se ajusta
            al aspect ratio del stream para que el cuadro quede sobre el video. */}
        <div id="picking-qr-reader" className="relative w-full" />

        {/* Cámara no disponible */}
        {cameraError && (
          <div className="flex flex-col items-center text-center px-8">
            <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6"/>
                <circle cx="12" cy="13" r="4" stroke="white" strokeWidth="1.5" strokeOpacity="0.6"/>
                <path d="M3 3l18 18" stroke="#F87171" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="text-white/50 text-sm font-600">{cameraError}</p>
            <p className="text-white/25 text-xs mt-1 font-500">Usa el campo manual de abajo o permite el acceso a la cámara</p>
          </div>
        )}

        {/* Success overlay */}
        {scanState === "success" && (
          <div key={`s-${animKey}`} className="absolute inset-0 flex items-center justify-center bg-green-500/10 animate-flash-green">
            <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center animate-check-pop shadow-[0_0_40px_rgba(34,197,94,0.5)]">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {scanState === "error" && (
          <div key={`e-${animKey}`} className="absolute inset-0 flex flex-col items-center justify-center bg-red-500/10">
            <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center animate-check-pop">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="mt-3 bg-[#0C0C0D]/90 rounded-xl px-4 py-2 mx-6 text-center">
              <p className="text-red-400 font-700 text-sm">Producto incorrecto</p>
              <p className="text-white/50 text-xs mt-1">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-5 left-5 w-9 h-9 rounded-xl bg-[#0C0C0D]/70 backdrop-blur-sm border border-white/10 flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M12 5l-7 7 7 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Counter badge */}
        <div className="absolute top-5 right-5 bg-[#0C0C0D]/80 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-1.5">
          <span className="text-amber-400 font-800 text-lg leading-none">{qty}</span>
          <span className="text-white/40 text-xs font-500"> / {product.quantity}</span>
        </div>

        {/* Ver mapa de la bodega */}
        <button
          onClick={onViewMap}
          className="absolute top-16 right-5 flex items-center gap-1.5 bg-[#0C0C0D]/80 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 active:bg-[#0C0C0D] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="#F59E0B" strokeWidth="1.8" />
            <rect x="14" y="3" width="7" height="7" rx="1.2" stroke="#F59E0B" strokeWidth="1.8" />
            <rect x="3" y="14" width="7" height="7" rx="1.2" stroke="#F59E0B" strokeWidth="1.8" />
            <rect x="14" y="14" width="7" height="7" rx="1.2" stroke="#F59E0B" strokeWidth="1.8" />
          </svg>
          <span className="text-amber-400 text-xs font-700">Mapa</span>
        </button>
      </div>

      {/* Product card */}
      <div className="bg-[#161618] border-t border-white/8 px-5 pt-4 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <ProductImage product={product} size={52} />
          <div className="flex-1 min-w-0">
            <p className="text-white font-700 text-sm leading-tight">{product.name}</p>
            <p className="text-white/40 text-xs font-500 mt-0.5">{product.sku}</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={`text-[11px] font-700 px-2 py-0.5 rounded-lg border ${product.shelfCode ? "bg-green-500/10 text-green-400 border-green-500/25" : "bg-amber-400/10 text-amber-400 border-amber-400/20"}`}>
                {product.shelfCode ? `${product.shelfCode}${product.rowNumber ? ` · Fila ${product.rowNumber}` : ""}` : "Sin ubicación"}
              </span>
              {product.plu && (
                <span className="text-[10px] font-700 bg-violet-500/20 text-violet-400 border border-violet-500/30 px-1.5 py-0.5 rounded-full">
                  PLU {product.plu}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Manual input */}
        <div className="flex gap-2 mb-4">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ingresar código manual..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60 transition-colors"
          />
          <button
            onClick={() => handleScan(input)}
            className="bg-amber-400 text-[#0C0C0D] rounded-xl px-4 font-700 text-sm active:scale-95 transition-all"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Screen: Checklist ────────────────────────────────────────────────────────

function ChecklistScreen({
  order,
  onConfirm,
  onBack,
}: {
  order: Order;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [showDialog, setShowDialog] = useState(false);
  const [missingProduct, setMissingProduct] = useState<string | null>(null);
  const missingItems = order.items.filter(i => i.scannedQty < i.quantity);

  return (
    <div className="h-full bg-[#0C0C0D] flex flex-col overflow-hidden">
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center active:bg-white/10 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div>
            <h2 className="text-white font-800 text-xl tracking-tight">Verificación final</h2>
            <p className="text-white/40 text-xs font-500">{order.code} · {order.customer}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
        {missingItems.length > 0 && (
          <div className="bg-amber-400/10 border border-amber-400/30 rounded-2xl p-4 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span className="text-amber-400 font-700 text-sm">{missingItems.length} producto(s) faltante(s)</span>
            </div>
            <p className="text-amber-400/70 text-xs font-500">Reporta los productos sin stock antes de entregar en caja.</p>
          </div>
        )}

        {order.items.map(product => {
          const done = product.scannedQty >= product.quantity;
          const isMissing = missingProduct === product.id;
          return (
            <div key={product.id} className={`rounded-2xl p-3.5 flex items-center gap-3 ${done ? "bg-green-500/8 border border-green-500/20" : "bg-amber-400/8 border border-amber-400/20"}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-green-500" : "bg-amber-400"}`}>
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M12 9v4M12 17h.01" stroke="#0C0C0D" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-700 truncate ${done ? "text-white/60" : "text-white"}`}>{product.name}</p>
                <p className="text-white/30 text-xs font-500 mt-0.5">×{product.quantity} · {product.sku}</p>
              </div>
              {!done && (
                <button
                  onClick={() => setMissingProduct(isMissing ? null : product.id)}
                  className="shrink-0 text-xs font-700 bg-amber-400/20 text-amber-400 border border-amber-400/30 px-2.5 py-1 rounded-lg active:bg-amber-400/30 transition-colors"
                >
                  Reportar
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-5 pb-8 pt-2">
        <button
          onClick={() => setShowDialog(true)}
          className="w-full bg-green-500 text-white font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all shadow-[0_8px_24px_rgba(34,197,94,0.25)]"
        >
          ENTREGADO EN CAJA
        </button>
      </div>

      {/* Confirm dialog */}
      {showDialog && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center pb-8 px-5 z-50">
          <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 w-full animate-fade-in">
            <div className="w-12 h-12 rounded-2xl bg-green-500/15 border border-green-500/30 flex items-center justify-center mb-4 mx-auto">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="text-white font-800 text-lg text-center mb-2">Confirmar entrega</h3>
            <p className="text-white/50 text-sm text-center mb-6">
              ¿Confirmas que el pedido <span className="text-white font-700">{order.code}</span> fue entregado en caja?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDialog(false)}
                className="flex-1 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white font-700 text-sm active:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => { setShowDialog(false); onConfirm(); }}
                className="flex-1 py-3.5 bg-green-500 rounded-xl text-white font-800 text-sm active:scale-95 transition-all"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Screen: Success ──────────────────────────────────────────────────────────

function SuccessScreen({ order, onBack }: { order: Order; onBack: () => void }) {
  return (
    <div className="h-full bg-[#0C0C0D] flex flex-col items-center justify-center px-8 text-center">
      <div className="w-24 h-24 rounded-full bg-green-500 flex items-center justify-center mb-6 animate-success-bounce shadow-[0_0_48px_rgba(34,197,94,0.4)]">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 className="text-white font-800 text-2xl tracking-tight mb-2">¡Entregado!</h2>
      <p className="text-white/50 text-base font-500 mb-1">Pedido {order.code}</p>
      <p className="text-white/30 text-sm font-500 mb-8">entregado exitosamente en caja</p>

      <div className="w-full bg-white/5 border border-white/8 rounded-2xl p-4 mb-8 text-left space-y-3">
        <div className="flex justify-between">
          <span className="text-white/40 text-sm font-500">Cliente</span>
          <span className="text-white font-600 text-sm">{order.customer}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/40 text-sm font-500">Total</span>
          <span className="text-white font-600 text-sm">{formatCOP(order.total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/40 text-sm font-500">Productos</span>
          <span className="text-white font-600 text-sm">{order.items.length} items</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/40 text-sm font-500">Sucursal</span>
          <span className="text-white font-600 text-sm">Centro</span>
        </div>
      </div>

      <button
        onClick={onBack}
        className="w-full bg-amber-400 text-[#0C0C0D] font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all"
      >
        Volver a la lista
      </button>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

type Screen = "list" | "detail" | "scanner" | "checklist" | "success" | "mapEditor" | "pickingMap";

export default function App() {
  const [screen, setScreen] = useState<Screen>("list");
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [activeProd, setActiveProd] = useState<Product | null>(null);
  const [toast, setToast] = useState<{ code: string } | null>(null);
  const [mapShelves, setMapShelves] = useState<PlacedShelf[]>(INITIAL_PLACED);
  const [mapPlaced, setMapPlaced] = useState<PlacedShelf[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  // Pantalla a la que volver cuando se cierra el mapa (detalle o escáner)
  const [mapReturnTo, setMapReturnTo] = useState<"detail" | "scanner">("detail");
  // Mapa como modal encima del escáner (la cámara sigue activa debajo)
  const [mapModalOpen, setMapModalOpen] = useState(false);
  // Picker (usuario) que usa la app
  const [pickers, setPickers] = useState<{ id: number; name: string }[]>([]);
  const [pickerId, setPickerId] = useState<number | null>(() => {
    const v = localStorage.getItem("picking.pickerId");
    return v ? Number(v) : null;
  });
  const [showPicker, setShowPicker] = useState(false);
  const pickerName = pickers.find(p => p.id === pickerId)?.name ?? null;
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const knownIds = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);

  function showToast(code: string) {
    setToast({ code });
    setTimeout(() => setToast(null), 3500);
  }

  async function loadQueue() {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const list = await pickingService.queue();
      const mapped = list.map(apiOrderToOrder);
      setOrders(mapped);
      // Avisar cuando llega un pedido nuevo sin revisar
      if (!firstLoad.current) {
        const fresh = list.filter(o => !o.reviewed && !knownIds.current.has(o.id));
        if (fresh.length > 0) showToast(fresh[0].referenceCode);
      }
      knownIds.current = new Set(list.map(o => o.id));
      firstLoad.current = false;
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : "No se pudo cargar la cola");
    } finally {
      setLoadingQueue(false);
    }
  }

  // Cargar la cola al abrir la app (sin login)
  useEffect(() => {
    void loadQueue();
  }, []);

  // Usuarios de picking + selector al entrar (si aún no hay picker elegido)
  useEffect(() => {
    pickingService
      .pickers()
      .then(list => {
        setPickers(list);
        const saved = localStorage.getItem("picking.pickerId");
        if (!saved || !list.some(p => p.id === Number(saved))) {
          setShowPicker(true);
        }
      })
      .catch(() => { /* sin usuarios, se sigue sin picker */ });
  }, []);

  function selectPicker(id: number) {
    setPickerId(id);
    localStorage.setItem("picking.pickerId", String(id));
    setShowPicker(false);
  }

  // Restaurar sesión tras recarga (el móvil puede matar la pestaña con el
  // escáner abierto): vuelve al mismo pedido/producto donde iba.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("picking.session");
      if (!saved) return;
      const s = JSON.parse(saved) as { orderId?: number; productId?: string };
      if (!s.orderId) return;
      void pickingService
        .detail(s.orderId)
        .then((detail) => {
          const order = apiOrderToOrder(detail);
          setActiveOrder(order);
          const target = order.items.find((i) => i.id === s.productId) ?? null;
          const pending = order.items.find((i) => i.scannedQty < i.quantity) ?? null;
          const next = target ?? pending;
          setActiveProd(next);
          setScreen(next ? "scanner" : "detail");
        })
        .catch(() => { /* sesión inválida: se queda en la lista */ });
    } catch {
      /* noop */
    }
  }, []);

  // Guardar la sesión actual (pedido + producto) para restaurarla si se recarga
  useEffect(() => {
    try {
      if (screen === "list" || !activeOrder) {
        sessionStorage.removeItem("picking.session");
        return;
      }
      sessionStorage.setItem(
        "picking.session",
        JSON.stringify({ orderId: Number(activeOrder.id), productId: activeProd?.id ?? null }),
      );
    } catch {
      /* noop */
    }
  }, [screen, activeOrder, activeProd]);

  // Refrescar la cola periódicamente para recibir los pedidos de la web
  useEffect(() => {
    const t = setInterval(() => { void loadQueue(); }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelectOrder(order: Order) {
    setActiveOrder(order);
    setScreen("detail");
    try {
      const detail = await pickingService.detail(Number(order.id));
      setActiveOrder(apiOrderToOrder(detail));
      // El picker actual se asigna al pedido (claim)
      if (pickerId) {
        void pickingService.claim(Number(order.id), pickerId);
      }
    } catch {
      // Se mantiene la vista con los datos de la cola
    }
  }

  async function handleMarkReviewed(id: string) {
    try {
      await pickingService.markReviewed(Number(id));
    } catch {
      /* si ya estaba revisado, se ignora */
    }
    setOrders(prev =>
      prev.map(o => o.id === id ? { ...o, reviewed: true } : o)
    );
    setActiveOrder(prev => (prev && prev.id === id ? { ...prev, reviewed: true } : prev));
  }

  function handleScanProduct(product: Product) {
    setActiveProd(product);
    setScreen("scanner");
  }

  function handleScanSuccess(result: ScanResult) {
    const itemId = String(result.itemId);
    setOrders(prev => prev.map(o => {
      if (o.id !== activeOrder?.id) return o;
      const items = o.items.map(i =>
        i.id === itemId ? { ...i, scannedQty: result.pickedQty } : i
      );
      return { ...o, status: "preparando" as OrderStatus, items };
    }));
    setActiveOrder(prev => {
      if (!prev) return prev;
      const items = prev.items.map(i =>
        i.id === itemId ? { ...i, scannedQty: result.pickedQty } : i
      );
      const updated = { ...prev, status: "preparando" as OrderStatus, items };
      if (!result.allDone) {
        setActiveProd(items.find(i => i.scannedQty < i.quantity) ?? null);
        setScreen("scanner");
      } else {
        setActiveProd(null);
        setScreen("checklist");
      }
      return updated;
    });
  }

  async function handleConfirmDelivery() {
    if (!activeOrder) return;
    try {
      await pickingService.complete(Number(activeOrder.id));
    } catch {
      /* si ya estaba entregado, se continúa igual */
    }
    setOrders(prev => prev.map(o =>
      o.id === activeOrder.id ? { ...o, status: "completado" as OrderStatus } : o
    ));
    setScreen("success");
  }

  function handleViewMap() {
    openMap("detail");
  }

  // Abre el mapa de la bodega; desde el escáner se abre como MODAL (la cámara
  // sigue activa debajo) y desde el detalle como pantalla completa.
  function openMap(returnTo: "detail" | "scanner") {
    setMapReturnTo(returnTo);
    if (returnTo === "detail" && activeOrder) {
      // Desde el detalle: apuntar al primer producto pendiente
      const first = activeOrder.items.find(i => i.scannedQty < i.quantity) ?? activeOrder.items[0];
      setActiveProd(first ?? null);
      setScreen("pickingMap");
    } else {
      // Desde el escáner activeProd ya es el producto que se está escaneando
      setMapModalOpen(true);
    }
    void loadMapData();
  }

  // Cargar estanterías reales y ubicaciones de los productos del pedido
  async function loadMapData() {
    if (!activeOrder) return;
    setMapLoading(true);
    setMapError(null);
    try {
      const branchId = activeOrder.branchId;
      const variantIds = activeOrder.items
        .map(i => i.variantId)
        .filter((v): v is number => v != null);
      const [shelves, locations] = await Promise.all([
        pickingService.shelves(branchId),
        pickingService.locations(branchId, variantIds),
      ]);
      const locByVariant = new Map(locations.map(l => [l.productVariantId, { shelfId: String(l.shelfId), rowNumber: l.rowNumber }]));
      setMapPlaced(shelves.map(s => ({
        id: String(s.id),
        code: s.code,
        name: s.name,
        type: s.type,
        color: s.color,
        rows: s.rows.map(r => ({ label: r.label })),
        gridX: s.posX,
        gridY: s.posY,
        rotation: s.rotation,
        width: s.width,
        height: s.height,
      })));
      // Rellenar la estantería de cada producto del pedido
      setActiveOrder(prev => prev ? {
        ...prev,
        items: prev.items.map(i => {
          const loc = i.variantId != null ? locByVariant.get(i.variantId) : undefined;
          return {
            ...i,
            shelfId: loc ? loc.shelfId : null,
            rowNumber: loc ? loc.rowNumber : null,
          };
        }),
      } : prev);
    } catch (e) {
      setMapError(e instanceof Error ? e.message : "No se pudo cargar el mapa");
    } finally {
      setMapLoading(false);
    }
  }

  // Phone frame wrapper
  const content = () => {
    switch (screen) {
      case "list": return (
        <OrderListScreen
          orders={orders}
          onSelectOrder={handleSelectOrder}
          onMarkReviewed={handleMarkReviewed}
          toast={toast}
          queueError={queueError}
          loading={loadingQueue}
          onRetry={() => void loadQueue()}
          pickerName={pickerName}
          onOpenPicker={() => setShowPicker(true)}
        />
      );
      case "detail": return activeOrder ? (
        <OrderDetailScreen
          order={activeOrder}
          onBack={() => setScreen("list")}
          onScanProduct={handleScanProduct}
          onViewMap={handleViewMap}
        />
      ) : null;
      case "scanner": return (activeProd && activeOrder) ? (
        <ScannerScreen
          product={activeProd}
          order={activeOrder}
          onScanSuccess={handleScanSuccess}
          onBack={() => setScreen("detail")}
          onViewMap={() => openMap("scanner")}
        />
      ) : null;
      case "checklist": return activeOrder ? (
        <ChecklistScreen
          order={activeOrder}
          onConfirm={handleConfirmDelivery}
          onBack={() => setScreen("detail")}
        />
      ) : null;
      case "success": return activeOrder ? (
        <SuccessScreen order={activeOrder} onBack={() => setScreen("list")} />
      ) : null;
      case "mapEditor": return (
        <WarehouseMapEditor
          initialPlaced={mapShelves}
          onBack={() => setScreen("list")}
          onSave={shelves => setMapShelves(shelves)}
        />
      );
      case "pickingMap": return renderMapContent(() => setScreen(mapReturnTo));
      default: return null;
    }
  };

  // Contenido del mapa de la bodega (pantalla completa o modal sobre el escáner)
  function renderMapContent(onBack: () => void) {
    if (!activeProd || !activeOrder) return null;
    const items = activeOrder.items;
    if (mapLoading && mapPlaced.length === 0) {
      return (
        <div className="h-full bg-[#0C0C0D] flex flex-col items-center justify-center px-8 text-center">
          <div className="w-10 h-10 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin mb-4" />
          <p className="text-white/40 text-sm font-500">Cargando mapa de la bodega…</p>
        </div>
      );
    }
    if (mapError && mapPlaced.length === 0) {
      return (
        <div className="h-full bg-[#0C0C0D] flex flex-col items-center justify-center px-8 text-center">
          <p className="text-red-400 text-sm font-600 mb-4">{mapError}</p>
          <button
            onClick={() => void loadMapData()}
            className="px-6 py-3 rounded-2xl bg-amber-400 text-[#0C0C0D] font-800 text-sm"
          >
            Reintentar
          </button>
        </div>
      );
    }
    // El producto activo puede haber sido reemplazado al cargar las
    // ubicaciones; buscamos la versión actualizada por id.
    const activeItem = items.find(i => i.id === activeProd.id) ?? activeProd;
    const activeLocation =
      activeItem.shelfId != null && activeItem.rowNumber != null
        ? { shelfId: activeItem.shelfId, rowNumber: activeItem.rowNumber }
        : null;
    const orderLocations = items
      .filter(i => i.id !== activeItem.id && i.shelfId != null && i.rowNumber != null)
      .map(i => ({ shelfId: i.shelfId as string, rowNumber: i.rowNumber as number }));
    return (
      <PickingMap
        placed={mapPlaced}
        activeLocation={activeLocation}
        orderLocations={orderLocations}
        orderCode={activeOrder.code}
        currentProductName={activeItem.name}
        scanned={items.filter(i => i.scannedQty >= i.quantity).length}
        total={items.length}
        onScan={() => { setScreen("scanner"); setMapModalOpen(false); }}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="h-dvh bg-[#0C0C0D] overflow-hidden">
      {content()}

      {/* Mapa de la bodega como MODAL sobre el escáner (la cámara sigue activa) */}
      {mapModalOpen && screen === "scanner" && activeProd && activeOrder && (
        <div className="absolute inset-0 z-[70] bg-[#0C0C0D] animate-fade-in">
          {renderMapContent(() => setMapModalOpen(false))}
        </div>
      )}

      {/* Selector de picker (usuario) */}
      {showPicker && pickers.length > 0 && (
        <div className="absolute inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center" onClick={() => pickerId != null && setShowPicker(false)}>
          <div
            className="w-full sm:max-w-sm bg-[#161618] border-t sm:border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 pb-8 max-h-[80dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-8 h-1 bg-white/20 rounded-full mx-auto mb-4 sm:hidden" />
            <h2 className="text-white font-800 text-lg mb-1">¿Quién eres?</h2>
            <p className="text-white/40 text-xs font-500 mb-4">Selecciona tu usuario para asignarte los pedidos que alistes.</p>
            <div className="space-y-2">
              {pickers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPicker(p.id)}
                  className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
                    pickerId === p.id
                      ? "bg-amber-400/15 border-amber-400 text-white"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                  }`}
                >
                  <span className="w-8 h-8 rounded-full bg-amber-400 text-[#0C0C0D] flex items-center justify-center text-xs font-800">
                    {p.name[0]?.toUpperCase()}
                  </span>
                  <span className="text-sm font-700">{p.name}</span>
                  {pickerId === p.id && <span className="ml-auto text-amber-400 text-xs font-800">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
