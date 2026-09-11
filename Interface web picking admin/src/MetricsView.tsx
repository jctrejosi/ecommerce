import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { api, ApiError, API_BASE_URL } from './services/api'
import type { PickerHistory, PickerSummary, PickingOrderDetail } from './types'

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

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  paid: { label: 'En cola', cls: 'bg-amber-400/15 text-amber-400 border-amber-400/30' },
  preparing: { label: 'Alistando', cls: 'bg-sky-400/15 text-sky-400 border-sky-400/30' },
  delivered: { label: 'Entregado', cls: 'bg-green-400/15 text-green-400 border-green-400/30' },
}

export default function MetricsView({ notify }: { notify: (m: string) => void }) {
  const [data, setData] = useState<PickerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<PickerHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [order, setOrder] = useState<PickingOrderDetail | null>(null)
  const [orderLoading, setOrderLoading] = useState(false)
  const socketRef = useRef<Socket | null>(null)

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

  // Eventos EN VIVO: cada acción del picker (claim / scan / entregado) refresca
  // las métricas al instante, sin polling.
  useEffect(() => {
    const socket = io(`${API_BASE_URL}/picking-events`, {
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('picking:claim', () => void load())
    socket.on('picking:scan', () => void load())

    socket.on('picking:delivered', (payload: { referenceCode?: string }) => {
      void load()
      notify(`📦 Pedido ${payload?.referenceCode ?? ''} entregado en caja`)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [load, notify])

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

  const connected = socketRef.current?.connected

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
          <div key={p.id} className="bg-[#161618] border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
            {/* Nombre */}
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-amber-400 text-[#0C0C0D] flex items-center justify-center font-extrabold">
                {p.name[0]?.toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="font-extrabold truncate">{p.name}</p>
                <p className="text-white/35 text-xs font-medium truncate">{p.email}</p>
              </div>
            </div>

            {/* Pedido actual */}
            {p.currentOrder ? (
              <div className="bg-[#0C0C0D] border border-white/10 rounded-xl p-3">
                <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider mb-1">Alistando ahora</p>
                <p className="font-extrabold text-sm">{p.currentOrder.referenceCode}</p>
                <p className="text-white/45 text-xs font-medium truncate">{p.currentOrder.customerName}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${STATUS_LABEL[p.currentOrder.status]?.cls ?? 'bg-white/10 text-white/60 border-white/20'}`}>
                    {STATUS_LABEL[p.currentOrder.status]?.label ?? p.currentOrder.status}
                  </span>
                  <span className="text-white/35 text-[10px] font-medium">{fmtTime(p.currentOrder.pickedAt)}</span>
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
                  {p.currentOrder.scannedPieces}/{p.currentOrder.totalPieces} piezas · {p.currentOrder.itemsCount} producto(s)
                </p>
                <button
                  onClick={() => void openOrder(p.currentOrder!.id)}
                  className="mt-2 w-full py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 transition-colors"
                >
                  Abrir pedido (picker y productos)
                </button>
              </div>
            ) : (
              <div className="bg-[#0C0C0D] border border-dashed border-white/10 rounded-xl p-3 text-center">
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
            className="w-full sm:max-w-3xl bg-[#161618] border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
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

      {/* Modal del pedido: picker + productos */}
      {order && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setOrder(null)}>
          <div
            className="w-full sm:max-w-2xl bg-[#161618] border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
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
                  <div className="bg-[#0C0C0D] border border-white/10 rounded-xl p-3 mb-4 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-amber-400 text-[#0C0C0D] flex items-center justify-center font-extrabold">
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
                      <div key={it.id} className="bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-3">
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
