import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './services/api'
import { ChatThread, onChatsChanged } from './PickerChat'
import { onPickingConnection, onPickingEvent } from './services/pickingSocket'
import { onOrderEvent } from './services/ordersSocket'
import type {
  PickerChatConversation,
  PickerHistory,
  PickerSummary,
  PickingOrderDetail,
} from './types'

const fmtTime = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Duración en mm:ss (o h:mm:ss) a partir de milisegundos. */
const fmtDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  paid: { label: 'En cola', cls: 'bg-amber-400/15 text-amber-400 border-amber-400/30' },
  preparing: { label: 'Alistando', cls: 'bg-sky-400/15 text-sky-400 border-sky-400/30' },
  ready: { label: 'Listo', cls: 'bg-teal-400/15 text-teal-400 border-teal-400/30' },
  shipped: { label: 'En camino', cls: 'bg-purple-400/15 text-purple-400 border-purple-400/30' },
  delivered: { label: 'Entregado', cls: 'bg-green-400/15 text-green-400 border-green-400/30' },
}

export default function MetricsView({ notify }: { notify: (m: string) => void }) {
  const [data, setData] = useState<PickerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<PickerHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [order, setOrder] = useState<PickingOrderDetail | null>(null)
  const [orderLoading, setOrderLoading] = useState(false)

  // ── Chat administrador ↔ picker ──
  // Bandeja: solo se usa para el badge de no leídos en cada tarjeta.
  const [chats, setChats] = useState<PickerChatConversation[]>([])
  // Picker con el hilo abierto (el hilo en sí vive en `PickerChat`).
  const [chatPicker, setChatPicker] = useState<{ id: number; name: string } | null>(null)
  // Estado de la conexión en vivo (la comparte `pickingSocket`).
  const [connected, setConnected] = useState(false)
  // Reloj para el tiempo transcurrido del pedido en curso.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    try {
      setData(await api.metrics())
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando métricas')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  // Bandeja de chats. Si el endpoint falla, se ignora: no debe tumbar las métricas.
  const loadChats = useCallback(async () => {
    try {
      setChats(await api.chatConversations())
    } catch {
      /* noop */
    }
  }, [])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // Respaldo por polling; el evento `picking:chat` refresca al instante.
  useEffect(() => {
    const t = setInterval(() => void loadChats(), 5000)
    return () => clearInterval(t)
  }, [loadChats])

  // Refresco con debounce: un solo escaneo puede generar varios eventos.
  const reloadTimer = useRef<number | null>(null)
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null
      void load()
    }, 400)
  }, [load])

  // Eventos EN VIVO del picking (conexión compartida, ver `pickingSocket`): cada
  // acción del picker (claim / scan / entregado en caja) refresca las métricas
  // al instante, sin polling.
  useEffect(() => onPickingConnection(setConnected), [])

  useEffect(() => onPickingEvent('picking:claim', scheduleReload), [scheduleReload])
  useEffect(() => onPickingEvent('picking:scan', scheduleReload), [scheduleReload])
  useEffect(
    () =>
      onPickingEvent<{ referenceCode?: string }>('picking:delivered', (payload) => {
        scheduleReload()
        notify(`📦 Pedido ${payload?.referenceCode ?? ''} entregado en caja`)
      }),
    [scheduleReload, notify],
  )

  // Los no leídos de cada tarjeta siguen lo que pasa en el chat.
  useEffect(() => onChatsChanged(() => void loadChats()), [loadChats])

  // Cambios de estado por CUALQUIER vía (creación, pago, admin, reparto: en
  // camino / entregado): misma conexión compartida (sala `staff`) que el resto
  // del panel. Refresca las métricas para que cada picker esté siempre al día.
  useEffect(() => onOrderEvent('order:updated', scheduleReload), [scheduleReload])

  // Limpieza del temporizador de refresco.
  useEffect(() => {
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    }
  }, [])

  async function openHistory(p: PickerSummary) {
    setHistoryLoading(true)
    try {
      setHistory(await api.pickerHistory(p.id))
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando historial')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function openOrder(id: number) {
    setOrderLoading(true)
    try {
      setOrder(await api.orderDetail(id))
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando el pedido')
    } finally {
      setOrderLoading(false)
    }
  }

  function closeChat() {
    setChatPicker(null)
  }

  function openChat(pickerId: number, name: string) {
    setChatPicker({ id: pickerId, name })
  }

  const unreadOf = (pickerId: number) =>
    chats.find((c) => c.pickerId === pickerId)?.unread ?? 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <p className="text-white/40 text-sm font-medium">
          Estado en vivo ·{' '}
          <span className={connected ? 'text-green-400' : 'text-amber-400'}>
            {connected ? 'conectado (tiempo real)' : 'reconectando…'}
          </span>
        </p>
        <button
          onClick={() => { setLoading(true); void load() }}
          disabled={loading}
          className="ml-auto px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold disabled:opacity-40"
        >
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {data.length === 0 && !loading && (
        <p className="text-white/30 text-sm text-center py-10">No hay usuarios de picking.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.map((p) => (
          <div key={p.id} className="bg-surface border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
            {/* Nombre */}
            <div className="flex items-center gap-3">
              {/* Foto que sube el picker desde la app móvil; si no tiene, su inicial. */}
              {p.avatarUrl ? (
                <img
                  src={p.avatarUrl}
                  alt={p.name}
                  className="w-10 h-10 rounded-full object-cover shrink-0 bg-white/5"
                />
              ) : (
                <span className="w-10 h-10 rounded-full bg-amber-400 text-on-accent flex items-center justify-center font-extrabold shrink-0">
                  {p.name[0]?.toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="font-extrabold truncate">{p.name}</p>
                <p className="text-white/35 text-xs font-medium truncate">{p.email}</p>
              </div>
              <span
                className={`ml-auto shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                  p.currentOrder
                    ? 'bg-sky-400/15 text-sky-400 border-sky-400/30'
                    : 'bg-emerald-400/15 text-emerald-400 border-emerald-400/30'
                }`}
              >
                {p.currentOrder ? 'Alistando' : 'Disponible'}
              </span>

              {/* Chat admin ↔ picker, con badge de no leídos */}
              <button
                onClick={() => void openChat(p.id, p.name)}
                title="Conversación con el picker"
                className="relative shrink-0 w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                {unreadOf(p.id) > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-on-accent text-[10px] font-extrabold flex items-center justify-center">
                    {unreadOf(p.id) > 9 ? '9+' : unreadOf(p.id)}
                  </span>
                )}
              </button>
            </div>

            {/* Pedido actual */}
            {p.currentOrder ? (
              <div className="bg-app border border-white/10 rounded-xl p-3">
                <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider mb-1">Alistando ahora</p>
                <p className="font-extrabold text-sm">{p.currentOrder.referenceCode}</p>
                <p className="text-white/45 text-xs font-medium truncate">{p.currentOrder.customerName}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${STATUS_LABEL[p.currentOrder.status]?.cls ?? 'bg-white/10 text-white/60 border-white/20'}`}>
                    {STATUS_LABEL[p.currentOrder.status]?.label ?? p.currentOrder.status}
                  </span>
                  <span className="text-white/35 text-[10px] font-medium">{fmtTime(p.currentOrder.pickedAt)}</span>
                  {p.currentOrder.pickedAt && (
                    <span className="ml-auto text-[11px] font-extrabold text-amber-400 tabular-nums">
                      ⏱ {fmtDuration(now - Date.parse(p.currentOrder.pickedAt))}
                    </span>
                  )}
                </div>
                {/* Progreso */}
                <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-500"
                    style={{
                      width: `${p.currentOrder.totalPieces > 0 ? Math.min(100, (p.currentOrder.scannedPieces / p.currentOrder.totalPieces) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p className="text-white/35 text-[10px] font-medium mt-1">
                  {p.currentOrder.scannedPieces}/{p.currentOrder.totalPieces} piezas ·
                  faltan{' '}
                  <span className="text-amber-400 font-bold">
                    {p.currentOrder.remainingPieces} pieza(s) · {p.currentOrder.remainingItems} producto(s)
                  </span>
                </p>
                <button
                  onClick={() => void openOrder(p.currentOrder!.id)}
                  className="mt-2 w-full py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 transition-colors"
                >
                  Abrir pedido (picker y productos)
                </button>
              </div>
            ) : (
              <div className="bg-app border border-dashed border-white/10 rounded-xl p-3 text-center">
                <p className="text-white/30 text-xs font-medium">Sin pedido en curso</p>
              </div>
            )}

            {/* Contadores */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-extrabold text-green-400">{p.completedToday}</p>
                <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider">Entregados hoy</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-extrabold">{p.dispatchedTotal}</p>
                <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider">Total despachado</p>
              </div>
            </div>

            <button
              onClick={() => void openHistory(p)}
              className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-bold hover:bg-white/10 transition-colors"
            >
              Ver historial completo →
            </button>
          </div>
        ))}
      </div>

      {/* Modal de historial */}
      {history && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setHistory(null)}>
          <div
            className="w-full sm:max-w-3xl bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-extrabold text-lg">Historial de {history.picker.name}</h2>
                <p className="text-white/40 text-xs font-medium">{history.orders.length} pedido(s) despachado(s)</p>
              </div>
              <button
                onClick={() => setHistory(null)}
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {historyLoading ? (
                <p className="text-white/40 text-sm text-center py-10">Cargando…</p>
              ) : history.orders.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-10">Aún no ha despachado pedidos.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/35 text-[10px] font-bold uppercase tracking-wider text-left">
                      <th className="pb-2 pr-3">Pedido</th>
                      <th className="pb-2 pr-3">Cliente</th>
                      <th className="pb-2 pr-3 text-right">Total</th>
                      <th className="pb-2 pr-3 text-center">Piezas</th>
                      <th className="pb-2 pr-3 text-right">Duración</th>
                      <th className="pb-2 pr-3">Entregado</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {history.orders.map((o) => (
                      <tr key={o.id} className="border-t border-white/5">
                        <td className="py-2.5 pr-3 font-bold">{o.referenceCode}</td>
                        <td className="py-2.5 pr-3 text-white/60 truncate max-w-[150px]">{o.customerName}</td>
                        <td className="py-2.5 pr-3 text-right font-bold">
                          {o.grandTotal.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 pr-3 text-center text-white/60">
                          {o.scannedPieces}/{o.totalPieces}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-amber-400 font-bold tabular-nums">
                          {o.pickedAt && o.completedAt
                            ? fmtDuration(Date.parse(o.completedAt) - Date.parse(o.pickedAt))
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-3 text-white/45 text-xs">{fmtTime(o.deliveredAt)}</td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => void openOrder(o.id)}
                            className="text-xs font-bold text-amber-400 hover:underline"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chat con el picker (el mismo componente que usa la bandeja del header) */}
      {chatPicker && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
          onClick={closeChat}
        >
          <div
            className="w-full sm:max-w-lg bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <ChatThread
              pickerId={chatPicker.id}
              name={chatPicker.name}
              onClose={closeChat}
              onRead={loadChats}
            />
          </div>
        </div>
      )}

      {/* Modal del pedido: picker + productos */}
      {order && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setOrder(null)}>
          <div
            className="w-full sm:max-w-2xl bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-extrabold text-lg">{order.referenceCode}</h2>
                <p className="text-white/40 text-xs font-medium">{order.customerName}</p>
              </div>
              <button
                onClick={() => setOrder(null)}
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {orderLoading ? (
                <p className="text-white/40 text-sm text-center py-10">Cargando…</p>
              ) : (
                <>
                  {/* Picker asociado */}
                  <div className="bg-app border border-white/10 rounded-xl p-3 mb-4 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-amber-400 text-on-accent flex items-center justify-center font-extrabold">
                      {order.pickerName?.[0]?.toUpperCase() ?? '?'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider">Picker asociado</p>
                      <p className="font-extrabold truncate">{order.pickerName ?? 'Sin asignar'}</p>
                    </div>
                    <span className={`ml-auto text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${STATUS_LABEL[order.status]?.cls ?? 'bg-white/10 text-white/60 border-white/20'}`}>
                      {STATUS_LABEL[order.status]?.label ?? order.status}
                    </span>
                  </div>

                  <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider mb-2">
                    Productos ({order.itemsCount}) · {order.scannedPieces}/{order.totalPieces} piezas
                  </p>
                  <div className="space-y-2">
                    {order.items.map((it) => (
                      <div key={it.id} className="bg-app border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold truncate">{it.name}</p>
                          <p className="text-white/35 text-[10px] font-medium truncate">
                            SKU {it.sku ?? '—'} · {it.barcode ?? 'sin código'}{it.plu ? ` · PLU ${it.plu}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-extrabold ${it.pickedQty >= it.quantity ? 'text-green-400' : 'text-amber-400'}`}>
                            {it.pickedQty}/{it.quantity}
                          </p>
                          <p className="text-white/30 text-[10px] font-medium">piezas</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
