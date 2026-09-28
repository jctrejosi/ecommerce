import { createSocketHub } from './socketHub'

/**
 * Socket del panel al namespace `/picking-events` (sala `staff`).
 *
 * El panel usa estos eventos en varios sitios: la pestaña Pickers (claim, scan,
 * entregado), las métricas y el chat del header, que debe avisar de los
 * mensajes de *cualquier* picker esté donde esté el administrador. Con una
 * conexión compartida se evita abrir un socket por componente (y que cada una
 * reciba su copia).
 */
const hub = createSocketHub('/picking-events', 'subscribe:staff')

/** Escucha un evento del picking en vivo. Devuelve la función para dejar de escucharlo. */
export const onPickingEvent = hub.on

/** Avisa cuando el socket se conecta o se cae (indicador "en vivo"). */
export const onPickingConnection = hub.onConnection
