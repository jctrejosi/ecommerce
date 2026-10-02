import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, resolveAssetUrl } from './services/api'
import { onPickingEvent } from './services/pickingSocket'
import { onOrderEvent } from './services/ordersSocket'
import type {
  PickingAdminOrder,
  PickingAdminOrdersResponse,
  PickingOrderDelivery,
  PickingOrderDetail,
} from './types'

// ─── Formato ──────────────────────────────────────────────────────────────────

const fmtTime = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Duración en mm:ss (o h:mm:ss) a partir de milisegundos. */
const fmtDuration = (ms: number | null) => {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

const money = (n: number) => `$${n.toLocaleString('es-CO')}`

type StatusStyle = { label: string; cls: string; dot: string }

const STATUS: Record<string, StatusStyle> = {
  created: { label: 'Creado', cls: 'bg-white/10 text-white/60 border-white/20', dot: 'bg-white/40' },
  payment_pending: { label: 'Pago pendiente', cls: 'bg-white/10 text-white/60 border-white/20', dot: 'bg-white/40' },
  paid: { label: 'En cola', cls: 'bg-amber-400/15 text-amber-400 border-amber-400/30', dot: 'bg-amber-400' },
  preparing: { label: 'Alistando', cls: 'bg-sky-400/15 text-sky-400 border-sky-400/30', dot: 'bg-sky-400' },
  ready: { label: 'Listo', cls: 'bg-teal-400/15 text-teal-400 border-teal-400/30', dot: 'bg-teal-400' },
  shipped: { label: 'En camino', cls: 'bg-purple-400/15 text-purple-400 border-purple-400/30', dot: 'bg-purple-400' },
  delivered: { label: 'Entregado', cls: 'bg-green-400/15 text-green-400 border-green-400/30', dot: 'bg-green-400' },
  cancelled: { label: 'Cancelado', cls: 'bg-red-400/15 text-red-400 border-red-400/30', dot: 'bg-red-400' },
  refunded: { label: 'Reembolsado', cls: 'bg-white/10 text-white/60 border-white/20', dot: 'bg-white/40' },
}

const statusOf = (s: string): StatusStyle =>
  STATUS[s] ?? { label: s, cls: 'bg-white/10 text-white/60 border-white/20', dot: 'bg-white/40' }

/** Chips de filtro: '' = todos. */
const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'paid', label: 'En cola' },
  { value: 'preparing', label: 'Alistando' },
  { value: 'ready', label: 'Listos' },
  { value: 'shipped', label: 'En camino' },
  { value: 'delivered', label: 'Entregados' },
  { value: 'cancelled', label: 'Cancelados' },
]

/** Tiempo de alistamiento: de la reclamación al cierre en caja (o al ahora). */
const pickingMillis = (o: PickingAdminOrder, now: number): number | null => {
  if (!o.pickedAt) return null
  const start = new Date(o.pickedAt).getTime()
  const end = o.completedAt ? new Date(o.completedAt).getTime() : now
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return end - start
}

/** Igual que `pickingMillis` pero a partir del detalle del pedido. */
const pickingMillisFromDetail = (d: PickingOrderDetail): number | null => {
  if (!d.pickedAt) return null
  const start = new Date(d.pickedAt).getTime()
  const end = d.completedAt ? new Date(d.completedAt).getTime() : Date.now()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return end - start
}

/** ¿El pedido trae dirección de entrega? Si no, se asume recogida en tienda. */
const hasAddress = (d: PickingOrderDelivery): boolean =>
  !!(d.line1 || d.line2 || d.city || d.zoneName || d.reference || d.instructions)

// ─── Vista ────────────────────────────────────────────────────────────────────

export default function OrdersView({
  branchId,
  branchName,
  notify,
}: {
  branchId: number | null
  branchName: string
  notify: (m: string) => void
}) {
  const [data, setData] = useState<PickingAdminOrdersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [detail, setDetail] = useState<PickingOrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // Arranca en `undefined` (no en null) para que "Todas" también cuente como
  // cambio de sucursal la primera vez.
  const lastBranch = useRef<number | null | undefined>(undefined)

  // La búsqueda no dispara una consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    try {
      // Sin sucursal: el backend lista los pedidos de todas.
      const res = await api.orders({
        branchId: branchId ?? undefined,
        status: status || undefined,
        search: appliedSearch || undefined,
        limit: 100,
      })
      setData(res)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando pedidos')
    } finally {
      setLoading(false)
    }
  }, [branchId, status, appliedSearch, notify])

  useEffect(() => {
    // Solo se marca "cargando" al cambiar de sucursal: filtrar no debe parpadear.
    if (lastBranch.current !== branchId) {
      lastBranch.current = branchId
      setLoading(true)
      setExpanded(null)
      setDetail(null)
    }
    void load()
  }, [load, branchId])

  // Reloj en vivo, solo si hay algún pedido alistándose.
  const hasLiveOrder = useMemo(
    () =>
      (data?.orders ?? []).some(
        (o) => !!o.pickedAt && !o.completedAt && (o.status === 'paid' || o.status === 'preparing'),
      ),
    [data],
  )
  useEffect(() => {
    if (!hasLiveOrder) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [hasLiveOrder])

  // Refresco en vivo (mismo patrón que el tab de Pickers): cada acción del picker
  // llega por socket y recarga la lista con un debounce.
  const reloadTimer = useRef<number | null>(null)
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null
      void load()
    }, 400)
  }, [load])

  // Refresco en vivo (conexión compartida, ver `pickingSocket` / `ordersSocket`):
  // cada acción del picker y cada cambio de estado llegan por socket y recargan
  // la lista con un debounce.
  useEffect(() => onPickingEvent('picking:claim', scheduleReload), [scheduleReload])
  useEffect(() => onPickingEvent('picking:scan', scheduleReload), [scheduleReload])
  useEffect(() => onPickingEvent('picking:delivered', scheduleReload), [scheduleReload])

  // Cambios de estado por cualquier otra vía (creación, pago, reparto, admin).
  useEffect(() => onOrderEvent('order:updated', scheduleReload), [scheduleReload])

  useEffect(() => {
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    }
  }, [])

  async function openOrder(o: PickingAdminOrder) {
    setExpanded(o.id)
    setDetail(null)
    setDetailLoading(true)
    try {
      setDetail(await api.orderDetail(o.id))
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando el detalle del pedido')
      setExpanded(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const orders = data?.orders ?? []
  const total = data?.total ?? 0

  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">Pedidos</h2>
          <p className="text-white/40 text-xs font-medium">
            {branchId ? branchName || 'Sucursal' : 'Todas las sucursales'} · {total} pedido
            {total === 1 ? '' : 's'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar referencia o cliente…"
              className="w-56 sm:w-64 bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400/60"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <button
            onClick={() => {
              setLoading(true)
              void load()
            }}
            title="Recargar"
            className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = f.value ? (data?.counts?.[f.value] ?? 0) : total
          const active = status === f.value
          return (
            <button
              key={f.value || 'all'}
              onClick={() => setStatus(f.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 ${
                active
                  ? 'bg-white text-app border-white'
                  : 'bg-white/5 text-white/50 border-white/10 hover:text-white/80'
              }`}
            >
              {f.value && <span className={`w-1.5 h-1.5 rounded-full ${statusOf(f.value).dot}`} />}
              {f.label}
              <span className={active ? 'text-app/50' : 'text-white/30'}>{n}</span>
            </button>
          )
        })}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-10 text-center text-white/40 text-sm">
          Cargando pedidos…
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-10 text-center">
          <p className="text-white/50 text-sm font-bold">No hay pedidos con estos filtros</p>
          <p className="text-white/30 text-xs mt-1">
            {status || appliedSearch
              ? 'Prueba con otro estado o limpia la búsqueda.'
              : 'Los pedidos aparecen aquí apenas entran a la sucursal.'}
          </p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-white/40 text-[11px] uppercase tracking-wider">
                  <th className="text-left font-bold px-4 py-3">Pedido</th>
                  <th className="text-left font-bold px-3 py-3">Cliente</th>
                  <th className="text-left font-bold px-3 py-3">Estado</th>
                  <th className="text-left font-bold px-3 py-3">Picker</th>
                  <th className="text-left font-bold px-3 py-3">Alistamiento</th>
                  <th className="text-left font-bold px-3 py-3">Tiempos</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = statusOf(o.status)
                  const pct =
                    o.totalPieces > 0
                      ? Math.min(100, Math.round((o.scannedPieces / o.totalPieces) * 100))
                      : 0
                  const ms = pickingMillis(o, now)
                  const running = !!o.pickedAt && !o.completedAt
                  return (
                    <FragmentRow
                      key={o.id}
                      order={o}
                      onOpen={() => void openOrder(o)}
                      status={st}
                      pct={pct}
                      ms={ms}
                      running={running}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
          {orders.length < total && (
            <p className="px-4 py-3 text-white/30 text-xs border-t border-white/5">
              Mostrando los {orders.length} pedidos más recientes de {total}.
            </p>
          )}
        </div>
      )}

      {expanded !== null && (
        <OrderDetailModal
          order={orders.find((o) => o.id === expanded) ?? null}
          detail={detail}
          loading={detailLoading}
          onClose={() => {
            setExpanded(null)
            setDetail(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Renglón + detalle ────────────────────────────────────────────────────────

function FragmentRow({
  order: o,
  onOpen,
  status: st,
  pct,
  ms,
  running,
}: {
  order: PickingAdminOrder
  onOpen: () => void
  status: StatusStyle
  pct: number
  ms: number | null
  running: boolean
}) {
  return (
    <tr
      onClick={onOpen}
      className="border-t border-white/5 cursor-pointer transition-colors hover:bg-white/[0.04]"
    >
        <td className="px-4 py-3 align-top">
          <p className="font-extrabold tracking-tight">{o.referenceCode}</p>
          <p className="text-white/40 text-xs">{money(o.grandTotal)}</p>
        </td>
        <td className="px-3 py-3 align-top">
          <p className="font-semibold">{o.customerName}</p>
          <p className="text-white/40 text-xs">{o.customerPhone ?? '—'}</p>
        </td>
        <td className="px-3 py-3 align-top">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${st.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            {st.label}
          </span>
        </td>
        <td className="px-3 py-3 align-top">
          {o.pickerName ? (
            <p className="font-semibold">{o.pickerName}</p>
          ) : (
            <span className="text-white/30 text-xs font-semibold">Sin asignar</span>
          )}
        </td>
        <td className="px-3 py-3 align-top min-w-[170px]">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${pct >= 100 ? 'bg-teal-400' : 'bg-amber-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-bold text-white/70">
              {o.scannedPieces}/{o.totalPieces}
            </span>
          </div>
          <p className="text-white/40 text-xs mt-1">
            {o.itemsCount} {o.itemsCount === 1 ? 'item' : 'items'}
            {o.remainingItems > 0 && (
              <span className="text-amber-400"> · faltan {o.remainingItems}</span>
            )}
          </p>
        </td>
        <td className="px-3 py-3 align-top">
          <p className="text-xs text-white/60">Creado {fmtTime(o.createdAt)}</p>
          {o.pickedAt && <p className="text-xs text-white/60">Tomado {fmtTime(o.pickedAt)}</p>}
          {o.completedAt && <p className="text-xs text-white/60">En caja {fmtTime(o.completedAt)}</p>}
          {o.deliveredAt && (
            <p className="text-xs text-green-400/80">Entregado {fmtTime(o.deliveredAt)}</p>
          )}
          <p className={`text-xs font-extrabold mt-1 ${running ? 'text-sky-400' : 'text-white/70'}`}>
            {running ? '⏱ ' : ''}
            {fmtDuration(ms)}
          </p>
        </td>
      </tr>
  )
}

// ─── Modal de detalle del pedido ──────────────────────────────────────────────

/**
 * Detalle completo del pedido: estado, cliente, entrega, pago, items
 * alistados (con su ubicación sugerida) y la bitácora de estados.
 */
function OrderDetailModal({
  order,
  detail,
  loading,
  onClose,
}: {
  order: PickingAdminOrder | null
  detail: PickingOrderDetail | null
  loading: boolean
  onClose: () => void
}) {
  // Esc cierra el modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const st = statusOf(detail?.status ?? order?.status ?? '')
  const total = detail?.grandTotal ?? order?.grandTotal ?? 0

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92dvh] bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-white/8 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-extrabold text-lg truncate">
              {detail?.referenceCode ?? order?.referenceCode ?? 'Pedido'}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${st.cls}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                {st.label}
              </span>
              <span className="text-white/40 text-xs font-medium">{money(total)}</span>
              {detail && (
                <span className="text-white/30 text-xs font-medium">
                  {detail.itemsCount} {detail.itemsCount === 1 ? 'item' : 'items'} ·{' '}
                  {detail.scannedPieces}/{detail.totalPieces} piezas
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Cerrar"
            className="shrink-0 w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Cuerpo scrolleable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-white/40 text-sm py-10 text-center">Cargando detalle…</p>
          ) : !detail ? (
            <p className="text-white/40 text-sm py-10 text-center">No se pudo cargar el detalle.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <DetailCard title="Cliente">
                  <DetailField label="Nombre" value={detail.customerName} />
                  <DetailField label="Teléfono" value={detail.customerPhone ?? '—'} />
                  <DetailField label="Email" value={detail.customerEmail ?? '—'} />
                </DetailCard>
                <DetailCard title="Alistamiento">
                  <DetailField label="Sucursal" value={detail.branchName ?? `#${detail.branchId}`} />
                  <DetailField label="Picker" value={detail.pickerName?.trim() || 'Sin asignar'} />
                  <DetailField label="Revisado" value={detail.reviewed ? 'Sí' : 'No'} />
                  <DetailField label="Duración" value={fmtDuration(pickingMillisFromDetail(detail))} />
                </DetailCard>
              </div>

              <DetailCard title="Entrega">
                {hasAddress(detail.delivery) ? (
                  <>
                    {detail.delivery.zoneName && (
                      <DetailField label="Zona" value={detail.delivery.zoneName} />
                    )}
                    <DetailField
                      label="Dirección"
                      value={
                        [detail.delivery.line1, detail.delivery.line2].filter(Boolean).join(', ') || '—'
                      }
                    />
                    <DetailField
                      label="Ciudad"
                      value={
                        [detail.delivery.city, detail.delivery.state].filter(Boolean).join(', ') || '—'
                      }
                    />
                    {detail.delivery.reference && (
                      <DetailField label="Referencia" value={detail.delivery.reference} />
                    )}
                    {detail.delivery.instructions && (
                      <DetailField label="Instrucciones" value={detail.delivery.instructions} />
                    )}
                  </>
                ) : (
                  <p className="text-white/35 text-sm">Sin dirección registrada (recogida en tienda).</p>
                )}
              </DetailCard>

              <DetailCard title="Pago">
                <AmountRow label="Subtotal" value={detail.subtotal} />
                {detail.discountTotal > 0 && (
                  <AmountRow label="Descuento" value={-detail.discountTotal} />
                )}
                {detail.taxTotal > 0 && <AmountRow label="Impuestos" value={detail.taxTotal} />}
                {detail.shippingCost > 0 && <AmountRow label="Envío" value={detail.shippingCost} />}
                {detail.shippingTax > 0 && (
                  <AmountRow label="Impuesto de envío" value={detail.shippingTax} />
                )}
                <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-white/10">
                  <span className="font-bold">Total</span>
                  <span className="font-extrabold text-amber-400">{money(detail.grandTotal)}</span>
                </div>
              </DetailCard>

              {(detail.notes || detail.internalNotes) && (
                <DetailCard title="Notas">
                  {detail.notes && <DetailField label="Cliente" value={detail.notes} />}
                  {detail.internalNotes && (
                    <DetailField label="Interna" value={detail.internalNotes} />
                  )}
                </DetailCard>
              )}

              <div>
                <p className="text-white/40 text-[11px] uppercase tracking-wider font-bold mb-2">
                  Items del pedido ({detail.itemsCount})
                </p>
                <div className="grid gap-1.5">
                  {detail.items.map((it) => {
                    const done = it.pickedQty >= it.quantity
                    const img = resolveAssetUrl(it.image)
                    return (
                      <div
                        key={it.id}
                        className="flex items-center gap-3 bg-white/5 border border-white/8 rounded-xl px-3 py-2"
                      >
                        {img ? (
                          <img
                            src={img}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover shrink-0 bg-white/5"
                          />
                        ) : (
                          <span
                            className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-extrabold ${
                              done ? 'bg-teal-400/20 text-teal-400' : 'bg-white/10 text-white/40'
                            }`}
                          >
                            {done ? '✓' : '·'}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{it.name}</p>
                          <p className="text-white/40 text-xs truncate">
                            {it.sku ? `SKU ${it.sku}` : ''}
                            {it.barcode ? ` · ${it.barcode}` : ''}
                            {it.plu ? ` · PLU ${it.plu}` : ''}
                          </p>
                          {it.shelfCode && (
                            <p className="text-amber-400/80 text-[11px] font-semibold mt-0.5">
                              📍 Estantería {it.shelfCode}
                              {it.shelfName ? ` · ${it.shelfName}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`text-sm font-extrabold ${
                              done ? 'text-teal-400' : 'text-amber-400'
                            }`}
                          >
                            {it.pickedQty}/{it.quantity}
                          </p>
                          <p className="text-white/40 text-[11px] tabular-nums">{money(it.total)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <DetailCard title="Historial de estados">
                <DetailField label="Creado" value={fmtTime(detail.createdAt)} />
                {detail.timeline.length > 0 ? (
                  <div className="flex flex-col gap-1.5 mt-1">
                    {detail.timeline.map((ev, idx) => {
                      const s = statusOf(ev.status)
                      return (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                          <span className="font-bold text-white/70">{s.label}</span>
                          {ev.pickerName && (
                            <span className="text-white/40 truncate">· {ev.pickerName.trim()}</span>
                          )}
                          {ev.note && <span className="text-white/30 truncate">· {ev.note}</span>}
                          <span className="ml-auto text-white/35 tabular-nums shrink-0">
                            {fmtTime(ev.createdAt)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <>
                    {detail.pickedAt && <DetailField label="Tomado" value={fmtTime(detail.pickedAt)} />}
                    {detail.completedAt && (
                      <DetailField label="En caja" value={fmtTime(detail.completedAt)} />
                    )}
                    {detail.deliveredAt && (
                      <DetailField label="Entregado" value={fmtTime(detail.deliveredAt)} />
                    )}
                  </>
                )}
              </DetailCard>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5">
      <p className="text-white/40 text-[11px] uppercase tracking-wider font-bold mb-2">{title}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-white/40 text-xs font-semibold w-24 shrink-0 pt-0.5">{label}</span>
      <span className="flex-1 min-w-0 break-words">{value}</span>
    </div>
  )
}

function AmountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/50">{label}</span>
      <span className="font-semibold tabular-nums">{money(value)}</span>
    </div>
  )
}
