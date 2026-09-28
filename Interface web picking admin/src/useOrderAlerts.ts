import { useCallback, useEffect, useState } from 'react'
import { onOrderEvent } from './services/ordersSocket'
import { notifyBrowser } from './services/browserNotifications'

/**
 * Avisos de pedidos para el administrador de picking.
 *
 * Se alimenta del evento `order:updated` del backend (namespace `/orders`, sala
 * `staff`), que es el punto único por el que pasa CADA acción sobre un pedido:
 * creación, confirmación de pago, alistamiento (claim / entregado en caja),
 * cambios del admin, reparto y cancelación.
 *
 * Cada aviso alimenta dos cosas: la campanita del header (con su contador de no
 * leídos) y la notificación del navegador. Es en memoria: al recargar el panel
 * la lista arranca vacía (es un tablero en vivo, no un buzón persistente).
 */

export interface OrderAlert {
  id: string
  referenceCode: string
  /** Estado ya normalizado al español (`preparando`, `listo`, ...). */
  status: string
  reason: string | null
  /** Picker que provocó la acción, cuando la provocó uno. */
  pickerName: string | null
  at: string
  read: boolean
}

/** Forma del payload que emite `OrdersGateway.notifyOrderStatus`. */
interface OrderUpdatedPayload {
  referenceCode?: string
  status?: string
  reason?: string | null
  at?: string
  pickerName?: string | null
}

/** Tope de avisos en memoria: es un tablero, no un histórico. */
const MAX_ALERTS = 40

/** Acción legible (sin el código del pedido) para un aviso. */
export function orderAlertAction(alert: OrderAlert): string {
  switch (alert.status) {
    case 'pendiente':
      return 'Nuevo pedido recibido'
    case 'preparando':
      return alert.pickerName ? `En preparación · ${alert.pickerName}` : 'En preparación'
    case 'listo':
      return alert.pickerName ? `Listo para entrega · ${alert.pickerName}` : 'Listo para entrega'
    case 'en camino':
      return 'En camino'
    case 'entregado':
      return 'Entregado'
    case 'cancelado':
      return alert.reason ? `Cancelado · ${alert.reason}` : 'Cancelado'
    default:
      return alert.status
  }
}

/** Línea completa del aviso, con el código del pedido delante. */
export function orderAlertText(alert: OrderAlert): string {
  return `Pedido ${alert.referenceCode} · ${orderAlertAction(alert)}`
}

export function useOrderAlerts(enabled: boolean): {
  alerts: OrderAlert[]
  unread: number
  markAllRead: () => void
} {
  const [alerts, setAlerts] = useState<OrderAlert[]>([])

  useEffect(() => {
    if (!enabled) return
    return onOrderEvent<OrderUpdatedPayload>('order:updated', (payload) => {
      const referenceCode = payload?.referenceCode?.trim()
      const status = payload?.status?.trim()
      if (!referenceCode || !status) return

      const at = payload.at ?? new Date().toISOString()
      const alert: OrderAlert = {
        id: `${referenceCode}-${status}-${at}-${Math.random().toString(36).slice(2, 7)}`,
        referenceCode,
        status,
        reason: payload.reason ?? null,
        pickerName: payload.pickerName ?? null,
        at,
        read: false,
      }

      setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS))
      notifyBrowser({
        title: `Pedido ${referenceCode}`,
        body: orderAlertAction(alert),
        tag: `order-${referenceCode}`,
      })
    })
  }, [enabled])

  const markAllRead = useCallback(() => {
    setAlerts((prev) =>
      prev.some((a) => !a.read)
        ? prev.map((a) => (a.read ? a : { ...a, read: true }))
        : prev,
    )
  }, [])

  const unread = alerts.reduce((n, a) => n + (a.read ? 0 : 1), 0)

  return { alerts, unread, markAllRead }
}
