import { Loader2, LocateFixed, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import type { AssignmentStatus, FleetDriver, FleetOrder } from '../types';
import { api, ApiError } from '../services/api';
import { STATUS_META } from '../lib/status';
import { formatDateTime, formatMoney, formatVolume } from '../lib/format';
import OrderDetailModal from './OrderDetailModal';

interface Props {
  /** Sube con cada aviso en vivo (socket / refresco periódico) para recargar. */
  reloadTick: number;
  onLocate: (driverId: number) => void;
  /** Sucursal seleccionada en el panel (null = todas). */
  branchId?: number | null;
  /** Flota cargada, para resolver foto/estado del repartidor en el detalle. */
  drivers?: FleetDriver[];
  /** Abre el chat con el repartidor del pedido. */
  onChat?: (driverId: number) => void;
  /**
   * Muestra en el mapa el recorrido de un pedido ENTRETADO (domicilio +
   * sucursal + ruta con su tiempo). Si no se provee, los entregados caen a
   * `onLocate` (posible repartidor sin pedido activo).
   */
  onViewOrderOnMap?: (order: FleetOrder) => void;
}

/** Cuántos pedidos se cargan por página (lazyload). */
const PAGE_SIZE = 20;
/** Tope de la recarga en vivo: nunca se piden más de estos de golpe. */
const MAX_REFRESH = 200;

const ORDER_FILTERS: { key: AssignmentStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'ASSIGNED', label: 'Por aceptar' },
  { key: 'READY_FOR_PICKUP', label: 'Recogiendo' },
  { key: 'PICKED_UP', label: 'Recogidos' },
  { key: 'IN_DELIVERY', label: 'En entrega' },
  { key: 'DELIVERED', label: 'Entregados' },
  { key: 'CANCELLED', label: 'Cancelados' },
];

/**
 * Pasos del repartidor, en orden. Se muestran solo los que ya ocurrieron, con
 * la hora en que ocurrieron, para poder ver cuándo hizo cada cosa.
 */
type TimelineKey =
  | 'assignedAt'
  | 'acceptedAt'
  | 'readyForPickupAt'
  | 'pickedUpAt'
  | 'inDeliveryAt';

const TIMELINE: { label: string; key: TimelineKey }[] = [
  { label: 'Asignado', key: 'assignedAt' },
  { label: 'Aceptado', key: 'acceptedAt' },
  { label: 'Recogiendo', key: 'readyForPickupAt' },
  { label: 'Recogido', key: 'pickedUpAt' },
  { label: 'En camino', key: 'inDeliveryAt' },
];

/**
 * Pestaña "Pedidos": todos los pedidos de la flota (activos, entregados y
 * cancelados) con lazyload de 20 en 20. El filtro y la búsqueda los resuelve el
 * backend, así que aplican sobre el total y no solo sobre lo ya cargado.
 */
export default function OrdersPanel({
  reloadTick,
  onLocate,
  branchId = null,
  drivers = [],
  onChat,
  onViewOrderOnMap,
}: Props) {
  const [orders, setOrders] = useState<FleetOrder[]>([]);
  /** Pedido abierto en el modal de detalle (null = cerrado). */
  const [selected, setSelected] = useState<FleetOrder | null>(null);

  /**
   * Pedidos entregados → recorrido histórico en el mapa; el resto → ubicar al
   * repartidor en vivo.
   */
  const viewOnMap = (order: FleetOrder) => {
    if (order.status === 'DELIVERED' && onViewOrderOnMap) onViewOrderOnMap(order);
    else onLocate(order.driverId);
  };
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AssignmentStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  /** Texto de búsqueda ya debounced (lo que se manda al API). */
  const [query, setQuery] = useState('');
  const loadedRef = useRef(0);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Búsqueda con debounce: evita una consulta por tecla.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadedRef.current = orders.length;
  }, [orders]);

  const load = useCallback(
    async (mode: 'reset' | 'more' | 'refresh') => {
      if (busyRef.current) return;
      const known = loadedRef.current;
      const first = mode !== 'more' && known === 0;
      busyRef.current = true;
      if (first) setLoading(true);
      else setLoadingMore(true);
      try {
        // 'more' avanza de a una página; 'refresh' recarga lo que ya había.
        const limit =
          mode === 'more'
            ? PAGE_SIZE
            : mode === 'refresh'
              ? Math.min(MAX_REFRESH, Math.max(PAGE_SIZE, known))
              : PAGE_SIZE;
        const offset = mode === 'more' ? known : 0;
        const page = await api.orders({
          limit,
          offset,
          status: filter === 'all' ? undefined : filter,
          q: query || undefined,
          branchId,
        });
        setOrders((prev) => (mode === 'more' ? [...prev, ...page.items] : page.items));
        setTotal(page.total);
        setError(null);
        // Filtro o búsqueda nuevos: la lista vuelve arriba (si no, el scroll al
        // fondo dispararía el lazyload con la lista ya cambiada).
        if (mode === 'reset' && scrollRef.current) scrollRef.current.scrollTop = 0;
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'No se pudieron cargar los pedidos.',
        );
      } finally {
        busyRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, query, branchId],
  );

  // Filtro o búsqueda nuevos: recarga desde cero.
  useEffect(() => {
    void load('reset');
  }, [load]);

  // Aviso en vivo (socket / refresco periódico): recarga lo cargado sin
  // perder el scroll. `load` cambia con los filtros, por eso no va en deps.
  useEffect(() => {
    void load('refresh');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const hasMore = orders.length < total;
  const vacio = !loading && orders.length === 0;

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!hasMore || busyRef.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) void load('more');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-5 pb-3">
        <div>
          <h1 className="text-lg font-bold text-ink">Pedidos</h1>
          <p className="text-xs text-ink-faint">
            {loading && orders.length === 0
              ? 'Cargando pedidos…'
              : `Mostrando ${orders.length} de ${total} pedidos`}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pedido, repartidor, cliente…"
            className="w-72 rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-xs outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-5 pb-3">
        {ORDER_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filter === f.key
                ? 'bg-invert text-invert-ink'
                : 'bg-surface text-ink-faint ring-1 ring-line hover:bg-surface-2'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-5 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
          {error}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="mx-5 flex-1 overflow-auto rounded-2xl border border-line bg-surface scrollbar-gutter-stable"
      >
        <table className="w-full table-fixed">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-line bg-surface-2 text-left">
              {/* Anchos fijos: sin esto, las columnas se redistribuyen según el
                  contenido de cada filtro y la tabla "baila" al cambiarlo. */}
              {(
                [
                  ['Pedido', 'w-[9.5%]'],
                  ['Repartidor', 'w-[10%]'],
                  ['Estado', 'w-[10.5%]'],
                  ['Cliente', 'w-[9.5%]'],
                  ['Dirección', 'w-[15%]'],
                  ['Pago', 'w-[9.5%]'],
                  ['Tiempos', 'w-[19%]'],
                  ['Total', 'w-[7%]'],
                  ['Volumen', 'w-[6%]'],
                  ['', 'w-[4%]'],
                ] as const
              ).map(([h, w]) => (
                <th
                  key={h}
                  className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint ${w}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && orders.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-xs text-ink-faint">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-faint" />
                </td>
              </tr>
            )}
            {vacio && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-xs text-ink-faint">
                  No hay pedidos con este filtro.
                </td>
              </tr>
            )}
            {orders.map((o) => {
              const meta = STATUS_META[o.status];
              return (
                <tr
                  key={o.assignmentId}
                  onClick={() => setSelected(o)}
                  className="cursor-pointer transition-colors hover:bg-surface-2"
                >
                  <td className="px-4 py-3">
                    <p className="truncate font-mono text-xs font-bold text-ink">{o.referenceCode}</p>
                    <p className="text-[11px] text-ink-faint">#{o.orderId}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="truncate text-xs font-semibold text-ink-soft">{o.driverName}</p>
                    <p className="text-[11px] text-ink-faint">{o.driverPlate ?? 'sin placa'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.badge}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="truncate text-xs font-semibold text-ink-soft">{o.customerName ?? '—'}</p>
                    <p className="text-[11px] text-ink-faint">{o.customerPhone ?? ''}</p>
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate text-xs text-ink-soft">
                      {[o.addressLine1, o.city].filter(Boolean).join(', ') || 'Sin dirección'}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        o.payment.method === 'CASH'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {o.payment.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      {TIMELINE.map((step) => {
                        const at = o[step.key];
                        if (!at) return null;
                        return (
                          <div key={step.key} className="flex items-baseline gap-2 whitespace-nowrap">
                            <span className="w-[84px] shrink-0 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                              {step.label}
                            </span>
                            <span className="text-xs text-ink-soft">{formatDateTime(at)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-ink">
                    {formatMoney(o.totals.value, o.totals.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-ink-soft">
                      {formatVolume(o.volume?.cm3)}
                    </p>
                    {o.volume?.estimated && (
                      <p className="text-[10px] text-amber-600" title="Hay ítems sin medidas en el catálogo">
                        aprox.
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        viewOnMap(o);
                      }}
                      title={
                        o.status === 'DELIVERED'
                          ? 'Ver el recorrido en el mapa'
                          : 'Ubicar en el mapa'
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sky-500 hover:bg-sky-50"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {orders.length > 0 && loadingMore && (
              <tr>
                <td colSpan={10} className="p-4 text-center text-xs text-ink-faint">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-ink-faint" />
                </td>
              </tr>
            )}
            {orders.length > 0 && !loadingMore && !hasMore && (
              <tr>
                <td colSpan={10} className="p-4 text-center text-xs text-ink-faint">
                  No hay más pedidos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <OrderDetailModal
          order={selected}
          driver={drivers.find((d) => d.id === selected.driverId) ?? null}
          onClose={() => setSelected(null)}
          onLocate={(driverId) => {
            setSelected(null);
            onLocate(driverId);
          }}
          onShowRoute={
            onViewOrderOnMap
              ? () => {
                  const o = selected;
                  setSelected(null);
                  onViewOrderOnMap(o);
                }
              : undefined
          }
          onChat={
            onChat
              ? (driverId) => {
                  setSelected(null);
                  onChat(driverId);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
