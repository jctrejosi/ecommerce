import { useEffect, useRef, useState } from 'react'
import { orderAlertText, useOrderAlerts } from './useOrderAlerts'
import { requestNotificationPermission } from './services/browserNotifications'

const fmtTime = (s: string) => {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Campanita de avisos de pedidos, al lado del chat del header.
 *
 * El contador (punto rojo) marca las acciones de pedido aún no vistas; al abrir
 * el panel se marcan como leídas. Los avisos los recolecta `useOrderAlerts` y
 * también disparan la notificación del navegador.
 */
export function NotificationsBell({ enabled }: { enabled: boolean }) {
  const { alerts, unread, markAllRead } = useOrderAlerts(enabled)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Cerrar al hacer clic fuera del panel.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) {
      markAllRead()
      // El permiso exige un gesto del usuario: se pide al abrir la campanita.
      void requestNotificationPermission()
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={toggle}
        title="Avisos de pedidos"
        aria-label="Avisos de pedidos"
        className="relative shrink-0 w-11 h-11 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all flex items-center justify-center"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13.7 21a2 2 0 0 1-3.4 0"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[19px] h-[19px] px-1 rounded-full bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-[#0C0C0D]">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full mt-2 z-50 w-[320px] max-w-[80vw] rounded-2xl bg-[#141518] border border-white/10 shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-sm font-extrabold text-white">Avisos de pedidos</p>
            <span className="text-[11px] font-bold text-white/40">
              {alerts.length === 0 ? '' : `${alerts.length}`}
            </span>
          </div>

          {alerts.length === 0 ? (
            <p className="px-4 py-6 text-center text-white/40 text-sm">
              Sin novedades todavía.
            </p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto [scrollbar-gutter:stable]">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="px-4 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${
                        a.read ? 'bg-white/15' : 'bg-amber-400'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs leading-snug ${
                          a.read ? 'text-white/60' : 'text-white/90 font-semibold'
                        }`}
                      >
                        {orderAlertText(a)}
                      </p>
                      <p className="text-[10px] text-white/35 mt-0.5 font-semibold">
                        {fmtTime(a.at)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
