import { io, type Socket } from 'socket.io-client'
import { API_BASE_URL } from './api'

/**
 * Conexión compartida a un namespace de socket.io, con los eventos
 * multiplexados.
 *
 * Varios componentes del panel escuchan el mismo flujo en vivo (chat, pedidos,
 * campanita). Abrir un socket por componente duplicaría conexiones y cada copia
 * recibiría el mismo evento, así que aquí se abre UNA conexión por namespace y
 * los componentes se suscriben a la lista de handlers de cada evento.
 */

export type SocketConnHandler = (connected: boolean) => void

export interface SocketHub {
  /** Escucha un evento. Devuelve la función para dejar de escucharlo. */
  on<T = unknown>(event: string, handler: (payload: T) => void): () => void
  /** Avisa cuando el socket se conecta o se cae (indicador "en vivo"). */
  onConnection(handler: SocketConnHandler): () => void
}

/**
 * @param namespace Namespace de socket.io (p. ej. `/orders`).
 * @param subscribeEvent Evento que se emite al conectar para unirse a la sala
 *   (p. ej. `subscribe:staff`); sin él no llegan los eventos.
 */
export function createSocketHub(
  namespace: string,
  subscribeEvent?: string,
): SocketHub {
  let socket: Socket | null = null
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()
  const connHandlers = new Set<SocketConnHandler>()

  function ensureSocket(): Socket {
    if (socket) return socket

    const s = io(`${API_BASE_URL}${namespace}`, {
      transports: ['websocket', 'polling'],
    })

    // Sala del panel: sin esto no llegan los eventos.
    s.on('connect', () => {
      if (subscribeEvent) s.emit(subscribeEvent)
      connHandlers.forEach((h) => h(true))
    })
    s.on('disconnect', () => connHandlers.forEach((h) => h(false)))

    socket = s
    return s
  }

  return {
    on(event, handler) {
      const s = ensureSocket()

      // El listener del socket se registra una sola vez por nombre de evento;
      // los componentes se suscriben a la lista de ese evento.
      let set = eventHandlers.get(event)
      if (!set) {
        set = new Set()
        eventHandlers.set(event, set)
        s.on(event, (payload: unknown) => set!.forEach((h) => h(payload)))
      }
      set.add(handler as (payload: unknown) => void)

      return () => {
        set?.delete(handler as (payload: unknown) => void)
      }
    },

    onConnection(handler) {
      const s = ensureSocket()
      connHandlers.add(handler)
      handler(s.connected)
      return () => {
        connHandlers.delete(handler)
      }
    },
  }
}
