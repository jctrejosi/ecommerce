-- 09_order_ready_status.sql
-- Estado "listo" (ready) del pedido.
--
-- El picker termina de alistar cuando escanea el último item. Antes de esto el
-- pedido se quedaba en 'preparing' hasta pulsar "entregado en caja", y ese botón
-- lo marcaba directamente como 'delivered' (entregado) antes de salir a la calle
-- (luego el repartidor lo devolvía a 'shipped' al arrancar, un retroceso visible
-- para el cliente).
--
-- Flujo nuevo:
--   created → payment_pending → paid → preparing → ready → shipped → delivered
--   (pendiente)                (preparando)      (listo)  (en camino) (entregado)
BEGIN;

ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'ready' BEFORE 'shipped';

COMMIT;
