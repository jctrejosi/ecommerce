import { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutGrid, List, Search, Download, Eye, Package,
  Clock, CheckCircle, Truck, XCircle, ChevronRight, MoreHorizontal,
  MapPin, Phone, CreditCard, Printer, RefreshCw, X, AlertTriangle,
  ListFilter, Layers, PackageCheck, CheckCheck, UserRound,
} from "lucide-react";
import { ordersService, type Order, type OrderDetail, type OrderStatus } from "../services/orders.service";
import { useOrderEvents } from "../hooks/useOrderEvents";

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string; border: string; colBg: string }> = {
  pendiente:  { label: "Pendiente",  color: "text-gray-600",   bg: "bg-gray-100",   border: "border-gray-200",  colBg: "bg-gray-50" },
  confirmado: { label: "Confirmado", color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200",  colBg: "bg-blue-50/50" },
  preparando: { label: "Preparando", color: "text-amber-700",  bg: "bg-amber-50",   border: "border-amber-200", colBg: "bg-amber-50/40" },
  listo:      { label: "Listo",      color: "text-teal-700",   bg: "bg-teal-50",    border: "border-teal-200",  colBg: "bg-teal-50/50" },
  "en camino":{ label: "En Camino",  color: "text-purple-700", bg: "bg-purple-50",  border: "border-purple-200",colBg: "bg-purple-50/40" },
  entregado:  { label: "Entregado",  color: "text-green-700",  bg: "bg-green-50",   border: "border-green-200", colBg: "bg-green-50/40" },
  cancelado:  { label: "Cancelado",  color: "text-red-700",    bg: "bg-red-50",     border: "border-red-200",   colBg: "bg-red-50/40" },
};

const STATUSES: OrderStatus[] = ["pendiente", "confirmado", "preparando", "listo", "en camino", "entregado", "cancelado"];

const STATUS_ICONS: Record<OrderStatus, typeof Clock> = {
  pendiente: Clock,
  confirmado: CheckCircle,
  preparando: Package,
  listo: PackageCheck,
  "en camino": Truck,
  entregado: CheckCheck,
  cancelado: XCircle,
};

const fmt = (n: number) => "$" + n.toLocaleString("es-CO");

/** Duración en mm:ss (o h:mm:ss) a partir de milisegundos. */
const fmtDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
};

/** Tiempo de alistamiento: en curso (cronómetro) o terminado (duración). */
function PickingTime({ order, now }: { order: Order; now: number }) {
  if (!order.pickedAt) return <span className="text-xs text-gray-300">—</span>;
  const end = order.completedAt ? Date.parse(order.completedAt) : now;
  const ms = end - Date.parse(order.pickedAt);
  return (
    <span className="text-xs font-mono font-bold text-amber-600">
      {order.completedAt ? "✓ " : "⏱ "}
      {fmtDuration(ms)}
    </span>
  );
}

/** Progreso del alistamiento: piezas escaneadas y faltantes. */
function PickingProgress({ order }: { order: Order }) {
  const total = order.totalPieces ?? 0;
  if (!total) return <span className="text-xs text-gray-300">—</span>;
  const scanned = order.scannedPieces ?? 0;
  const pct = Math.min(100, (scanned / total) * 100);
  const done = (order.remainingPieces ?? 0) === 0;
  return (
    <div className="flex flex-col gap-1 min-w-[110px]">
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <span className={done ? "text-emerald-600" : "text-gray-600"}>
          {scanned}/{total} piezas
        </span>
        {!done && <span className="text-amber-600">faltan {order.remainingPieces}</span>}
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {done && <span className="text-[10px] text-emerald-600 font-semibold">Listo</span>}
    </div>
  );
}

const DELIVERY_STATUSES: OrderStatus[] = ["en camino", "entregado"];

/** Persona responsable del pedido: repartidor (entrega) o preparador (picking). */
function responsibleOf(
  order: Order,
): { role: string; name: string; type: "driver" | "picker" } | null {
  if (DELIVERY_STATUSES.includes(order.status) && order.driverName) {
    return { role: "Repartidor", name: order.driverName, type: "driver" };
  }
  if (order.pickerName) {
    return { role: "Preparador", name: order.pickerName, type: "picker" };
  }
  if (order.driverName) {
    return { role: "Repartidor", name: order.driverName, type: "driver" };
  }
  return null;
}

function ResponsibleTag({ order }: { order: Order }) {
  const responsible = responsibleOf(order);
  if (!responsible) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-gray-400 italic">
        <UserRound size={11} className="shrink-0" /> Sin asignar
      </span>
    );
  }
  const Icon = responsible.type === "driver" ? Truck : UserRound;
  return (
    <span className="flex items-center gap-1 text-[10px] text-gray-500 min-w-0">
      <Icon size={11} className="text-gray-400 shrink-0" />
      <span className="font-semibold text-gray-600 shrink-0">{responsible.role}:</span>
      <span className="truncate">{responsible.name}</span>
    </span>
  );
}

function KanbanCard({ order, onClick, onConfirmPayment, now }: { order: Order; onClick: () => void; onConfirmPayment?: (o: Order) => void; now: number }) {
  const cfg = STATUS_CONFIG[order.status];
  const isPending = order.status === "pendiente";
  return (
    <div className="bg-white rounded-xl border border-gray-100 hover:shadow-md transition-all hover:border-gray-200 overflow-hidden">
      {isPending && onConfirmPayment && (
        <button
          onClick={(e) => { e.stopPropagation(); onConfirmPayment(order); }}
          className="w-full px-3 py-1.5 text-[10px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center justify-center gap-1"
        >
          <CheckCircle size={10} /> Confirmar pago
        </button>
      )}
      <div
        onClick={onClick}
        className="p-3 cursor-pointer"
      >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono font-bold text-gray-600">{order.id}</span>
        <span className="text-xs text-gray-400">{order.time}</span>
      </div>
      <p className="text-sm font-semibold text-gray-800 mb-1">{order.customer}</p>
      <p className="text-xs text-gray-400 mb-3 truncate">{order.address}</p>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-900">{fmt(order.total)}</span>
        <span className="text-xs text-gray-400">{order.itemsCount} items</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{order.payment}</span>
        {order.note && <span className="text-[10px] text-gray-400">📝 nota</span>}
      </div>
      {order.totalPieces ? (
        <div className="mt-2 flex items-center justify-between text-[11px] font-semibold">
          <span className={(order.remainingPieces ?? 0) === 0 ? "text-emerald-600" : "text-gray-600"}>
            {order.scannedPieces}/{order.totalPieces} piezas
          </span>
          {(order.remainingPieces ?? 0) > 0 && (
            <span className="text-amber-600">faltan {order.remainingPieces}</span>
          )}
        </div>
      ) : null}
      <div className="mt-2 pt-2 border-t border-gray-50 flex items-center justify-between">
        <ResponsibleTag order={order} />
        <PickingTime order={order} now={now} />
      </div>
      </div>
    </div>
  );
}

function ConfirmStatusDialog({
  order,
  toStatus,
  onConfirm,
  onCancel,
}: {
  order: Order;
  toStatus: OrderStatus;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fromCfg = STATUS_CONFIG[order.status];
  const toCfg = STATUS_CONFIG[toStatus];
  const danger = toStatus === "cancelado";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${danger ? "bg-red-50" : "bg-amber-50"}`}
          >
            <AlertTriangle
              size={18}
              className={danger ? "text-red-500" : "text-amber-500"}
            />
          </div>
          <div>
            <h3 className="font-bold text-sm text-gray-900">
              Cambiar estado del pedido
            </h3>
            <p className="text-xs text-gray-400 font-mono">{order.id}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-5">
          ¿Cambiar el estado de{" "}
          <span className="font-semibold text-gray-800">{order.customer}</span> de{" "}
          <span className={`font-semibold ${fromCfg.color}`}>{fromCfg.label}</span>{" "}
          a{" "}
          <span className={`font-semibold ${toCfg.color}`}>{toCfg.label}</span>?
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 hover:bg-gray-50 transition-colors text-gray-500 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors cursor-pointer ${danger ? "bg-red-500 hover:bg-red-600" : "bg-gray-900 hover:bg-gray-800"}`}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderDetail({ order: initialOrder, onClose, onStatusChange }: { order: Order; onClose: () => void; onStatusChange: (o: Order, s: OrderStatus) => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const cfg = STATUS_CONFIG[order?.status ?? initialOrder.status];

  useEffect(() => {
    ordersService.getById(initialOrder.orderId.toString())
      .then(setOrder)
      .catch(() => setOrder({ ...initialOrder, items: [] }))
      .finally(() => setLoading(false));
    // `initialOrder.status` en las deps: si el estado cambia en vivo (el picker
    // avanza el pedido), el detalle abierto se vuelve a cargar solo.
  }, [initialOrder.orderId, initialOrder.status]);

  const timeline = order?.statusHistory?.map((h, i, arr) => ({
    status: h.status,
    time: h.time,
    done: i < arr.length,
  })) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white flex flex-col shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold text-gray-900 font-mono">{initialOrder.id}</h2>
            <p className="text-xs text-gray-400">{initialOrder.date} a las {initialOrder.time}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Printer size={12} /> Factura
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 cursor-pointer">✕</button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Cliente */}
          <div>
            <p className="text-sm font-bold text-gray-800">{initialOrder.customer}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Phone size={10} /> {initialOrder.phone}</span>
              <span className="flex items-center gap-1"><MapPin size={10} /> {initialOrder.address}</span>
            </div>
          </div>

          {/* Responsable */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-4 py-3">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider shrink-0">Responsable</span>
            <ResponsibleTag order={initialOrder} />
          </div>

          {/* Estado actual */}
          <div className={`rounded-xl p-4 border ${cfg.bg} ${cfg.border}`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold ${cfg.color}`}>{cfg.label}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                {initialOrder.payment}
              </span>
            </div>
            <div className="mt-3">
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                Cambiar estado
              </label>
              <select
                value={initialOrder.status}
                onChange={(e) =>
                  onStatusChange(initialOrder, e.target.value as OrderStatus)
                }
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Timeline */}
          {timeline.length > 0 && (
            <div className="relative pl-6 border-l-2 border-gray-200 space-y-4">
              {timeline.map((step, i) => (
                <div key={i} className="relative">
                  <div className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 ${step.done ? "bg-amber-400 border-amber-400" : "bg-white border-gray-300"}`} />
                  <p className={`text-xs font-semibold ${step.done ? "text-gray-800" : "text-gray-400"}`}>
                    {step.status}
                  </p>
                  <p className="text-[10px] text-gray-400">{step.time}</p>
                </div>
              ))}
            </div>
          )}

          {/* Items */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">Productos</h4>
            <div className="space-y-2">
              {loading ? (
                <p className="text-xs text-gray-400">Cargando...</p>
              ) : (
                (order?.items ?? []).map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.qty} x {fmt(item.price)}</p>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{fmt(item.qty * item.price)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <span className="text-sm font-semibold text-gray-800">Total</span>
            <span className="text-lg font-bold text-gray-900">{fmt(initialOrder.total)}</span>
          </div>

          {/* Nota */}
          {initialOrder.note && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700">{initialOrder.note}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Orders() {
  const [mode, setMode] = useState<"kanban" | "table">("kanban");
  const [selected, setSelected] = useState<Order | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<OrderStatus[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{
    order: Order;
    toStatus: OrderStatus;
  } | null>(null);
  // Reloj para el cronómetro de alistamiento en vivo.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ordersService.getAll({
        search: search || undefined,
        limit: 100,
      });
      setOrders(data);
    } catch (err) {
      console.error("Error fetching orders:", err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Refresco silencioso (sin parpadear el spinner) para las actualizaciones en vivo.
  const refreshOrders = useCallback(async () => {
    try {
      const data = await ordersService.getAll({
        search: search || undefined,
        limit: 100,
      });
      setOrders(data);
    } catch {
      /* se reintenta con el siguiente evento */
    }
  }, [search]);

  // Cambios de estado en vivo (picking, reparto, pagos, otros admins): se
  // refresca la lista con un pequeño debounce para no disparar en ráfaga
  // cuando el picker escanea varios productos seguidos.
  const liveTimer = useRef<number | null>(null);
  useOrderEvents(() => {
    if (liveTimer.current) window.clearTimeout(liveTimer.current);
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = null;
      void refreshOrders();
    }, 900);
  });

  useEffect(() => {
    return () => {
      if (liveTimer.current) window.clearTimeout(liveTimer.current);
    };
  }, []);

  // Cambio de estado manual: primero se pide confirmación (acción administrativa)
  const requestStatusChange = (o: Order, toStatus: OrderStatus) => {
    if (o.status === toStatus) return;
    setConfirmAction({ order: o, toStatus });
  };

  const applyStatusChange = async () => {
    if (!confirmAction) return;
    const { order, toStatus } = confirmAction;
    try {
      await ordersService.updateStatus(
        order.orderId.toString(),
        toStatus,
      );
      // Reflejar el nuevo estado en el detalle abierto
      setSelected((prev) =>
        prev && prev.orderId === order.orderId
          ? { ...prev, status: toStatus }
          : prev,
      );
      setConfirmAction(null);
      fetchOrders();
    } catch (err) {
      console.error("Error al cambiar estado:", err);
      setConfirmAction(null);
    }
  };

  const handleConfirmPayment = (o: Order) => {
    requestStatusChange(o, "confirmado");
  };

  const toggleStatusFilter = (s: OrderStatus) => {
    setStatusFilters((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const clearStatusFilters = () => {
    setStatusFilters([]);
  };

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Mark loaded orders as reviewed
  useEffect(() => {
    if (orders.length > 0) {
      orders.forEach((o) => {
        ordersService.markAsReviewed(o.orderId.toString()).catch(() => {});
      });
    }
  }, [orders]);

  const filtered = orders.filter((o) => {
    const matchSearch =
      !search ||
      o.customer.toLowerCase().includes(search.toLowerCase()) ||
      o.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilters.length === 0 || statusFilters.includes(o.status);
    return matchSearch && matchStatus;
  });

  const counts = STATUSES.reduce(
    (acc, s) => {
      acc[s] = orders.filter((o) => o.status === s).length;
      return acc;
    },
    {} as Record<OrderStatus, number>,
  );

  const hasFilters = statusFilters.length > 0;

  return (
    <>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? "Cargando..." : `${orders.length} pedidos · ${counts.pendiente ?? 0} pendientes de acción`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1">
              <button onClick={() => setMode("kanban")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${mode === "kanban" ? "bg-amber-400 text-amber-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                <LayoutGrid size={14} /> Kanban
              </button>
              <button onClick={() => setMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${mode === "table" ? "bg-amber-400 text-amber-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                <List size={14} /> Tabla
              </button>
            </div>
            <button
              disabled
              title="Exportación próximamente"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 bg-white border border-gray-200 rounded-xl cursor-not-allowed opacity-60"
            >
              <Download size={14} /> Exportar
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 lg:grid-cols-7 gap-3">
          {STATUSES.map((s) => {
            const count = counts[s] ?? 0;
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => toggleStatusFilter(s)}
                className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                  statusFilters.includes(s)
                    ? `${cfg.bg} ${cfg.color} border-transparent ring-2 ring-inset ring-current`
                    : "bg-white border-gray-200 hover:bg-gray-50"
                }`}
              >
                <p className={`text-lg font-bold ${statusFilters.includes(s) ? cfg.color : "text-gray-800"}`}>{count}</p>
                <p className={`text-[10px] font-semibold ${statusFilters.includes(s) ? cfg.color : "text-gray-500"}`}>{cfg.label}</p>
              </button>
            );
          })}
        </div>

        {/* Search + Filter tags */}
        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pedido o cliente..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
            />
          </div>

          {/* Filtros por estado (multiselección) */}
          <div>
            <div className="mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-gray-700 uppercase tracking-wider">
                <ListFilter size={14} className="text-gray-400" />
                Filtrar por estado
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={clearStatusFilters}
                title="Ver todos los pedidos"
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer ${
                  !hasFilters
                    ? "bg-gray-800 text-white border-gray-800 shadow-sm"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700 hover:shadow-sm"
                }`}
              >
                <Layers size={12} />
                Todos
              </button>
              {STATUSES.map((s) => {
                const cfg = STATUS_CONFIG[s];
                const Icon = STATUS_ICONS[s];
                const isActive = statusFilters.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleStatusFilter(s)}
                    title={isActive ? `Quitar filtro: ${cfg.label}` : `Filtrar por estado: ${cfg.label}`}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer ${cfg.bg} ${cfg.color} ${cfg.border} ${
                      isActive
                        ? "ring-2 ring-current ring-offset-1 shadow-sm"
                        : "opacity-70 hover:opacity-100 hover:shadow-sm"
                    }`}
                  >
                    <Icon size={12} />
                    {cfg.label}
                    <X size={12} className={isActive ? "" : "opacity-0"} />
                  </button>
                );
              })}
              <button
                onClick={clearStatusFilters}
                title="Quitar todos los filtros"
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-all flex items-center gap-1.5 cursor-pointer ${
                  hasFilters ? "" : "invisible"
                }`}
              >
                <X size={12} /> Limpiar filtros
              </button>
            </div>
          </div>
        </div>

        {/* Pedidos listados (resultado de los filtros) */}
        <div className="flex items-center gap-2 pt-1">
          <Package size={16} className="text-amber-500" />
          <h2 className="text-sm font-bold text-gray-800">Listado de pedidos</h2>
          {!loading && (
            <span className="text-xs font-semibold text-gray-400">
              {filtered.length} {filtered.length === 1 ? "pedido" : "pedidos"}
            </span>
          )}
        </div>

        {/* Kanban */}
        {mode === "kanban" && (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {(hasFilters ? statusFilters : STATUSES).map((s) => {
              const cfg = STATUS_CONFIG[s];
              const col = filtered.filter((o) => o.status === s);
              return (
                <div key={s} className="min-w-60 w-60 shrink-0">
                  <div className={`rounded-xl p-3 mb-3 flex items-center justify-between ${cfg.bg}`}>
                    <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                    <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                      {col.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {col.map((o) => (
                      <KanbanCard key={o.id} order={o} now={now} onClick={() => setSelected(o)} onConfirmPayment={handleConfirmPayment} />
                    ))}
                    {col.length === 0 && (
                      <div className="text-center py-6 text-xs text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                        Sin pedidos
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Table */}
        {mode === "table" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-gray-400">Cargando pedidos...</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Pedido</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Cliente</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Responsable</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Progreso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Alistamiento</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Pago</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Hora</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((o) => {
                    const cfg = STATUS_CONFIG[o.status];
                    return (
                      <tr key={o.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelected(o)}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono font-bold text-gray-700">{o.id}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-800">{o.customer}</p>
                          <p className="text-xs text-gray-400">{o.itemsCount} productos</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ResponsibleTag order={o} />
                        </td>
                        <td className="px-4 py-3">
                          <PickingProgress order={o} />
                        </td>
                        <td className="px-4 py-3">
                          <PickingTime order={o} now={now} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-bold text-gray-900">{fmt(o.total)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{o.payment}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-gray-400 font-mono">{o.time}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {o.status === "pendiente" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleConfirmPayment(o); }}
                                className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                              >
                                Confirmar
                              </button>
                            )}
                            <ChevronRight size={14} className="text-gray-400" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">
                        No se encontraron pedidos
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {selected && (
        <OrderDetail
          order={selected}
          onClose={() => setSelected(null)}
          onStatusChange={requestStatusChange}
        />
      )}
      {confirmAction && (
        <ConfirmStatusDialog
          order={confirmAction.order}
          toStatus={confirmAction.toStatus}
          onConfirm={applyStatusChange}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}
