import { createSocketHub } from './socketHub'

/**
 * Socket del panel al namespace `/orders` (sala `staff`).
 *
 * Trae el cambio de estado de *cualquier* pedido, venga de donde venga: creación
 * por el cliente, confirmación de pago, alistamiento (claim / entregado en
 * caja), cambios del admin, reparto (`en camino` / `entregado`) o cancelación.
 * Es el punto único de difusión del backend (`OrdersGateway.notifyOrderStatus`),
 * así que la campanita y las vistas en vivo no se pierden ninguna acción.
 */
const hub = createSocketHub('/orders', 'subscribe:staff')

/** Escucha un evento de pedidos en vivo. Devuelve la función para dejar de escucharlo. */
export const onOrderEvent = hub.on

/** Avisa cuando el socket se conecta o se cae (indicador "en vivo"). */
export const onOrdersConnection = hub.onConnection
