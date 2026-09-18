import { resolveApiBaseUrl } from "../lib/api";
import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

const API_URL = resolveApiBaseUrl()

export interface OrderEventPayload {
  referenceCode: string
  /** Estado ya normalizado para la UI: preparando | listo | en camino | entregado | cancelado... */
  status: string
  reason: string | null
  at: string
}

/**
 * Cambios de estado de pedidos en vivo (namespace `/orders`, sala `staff`).
 *
 * El backend emite `order:updated` en **cada** transición, venga de donde venga:
 * confirmación de pago, picking (reclamar / escanear / entregado en caja),
 * cambio manual del admin o avance del repartidor (en camino / entregado).
 *
 * `onChange` se llama con cada evento; deja el debounce del lado del consumidor
 * si vas a disparar peticiones.
 */
export function useOrderEvents(onChange: (payload: OrderEventPayload) => void) {
  // Ref para no reconectar cada vez que cambia el callback, y para que el
  // callback siempre vea el estado más reciente del componente.
  const handler = useRef(onChange)
  handler.current = onChange

  useEffect(() => {
    const socket = io(`${API_URL}/orders`, {
      transports: ['websocket', 'polling'],
    })

    const subscribe = () => socket.emit('subscribe:staff')
    socket.on('connect', subscribe)
    socket.on('order:updated', (payload: OrderEventPayload) => {
      handler.current(payload)
    })

    return () => {
      socket.emit('unsubscribe:staff')
      socket.off('connect', subscribe)
      socket.disconnect()
    }
  }, [])
}
