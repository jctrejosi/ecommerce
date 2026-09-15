-- 10_delivery_driver_presence.sql
-- Presencia del repartidor: última señal de la app.
--
-- Hasta ahora el panel solo conocía `last_location_at`, que se actualiza con
-- cada ping GPS. Como los pings GPS únicamente se envían durante una entrega
-- activa, un repartidor con la app cerrada hacía horas se veía igual que uno
-- conectado sin pedido (ambos "disponibles").
--
-- `last_seen_at` es la marca de "la app sigue viva":
--   - se actualiza con cada ping GPS (`POST /delivery/location`), y
--   - con el heartbeat que la app envía cada minuto mientras hay sesión
--     (`POST /delivery/heartbeat`).
--
-- Sin señal dentro de la ventana de presencia, el repartidor se muestra como
-- "Desconectado" en el panel.
BEGIN;

ALTER TABLE delivery_drivers
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Los repartidores existentes heredan su última señal GPS conocida.
UPDATE delivery_drivers
   SET last_seen_at = last_location_at
 WHERE last_seen_at IS NULL
   AND last_location_at IS NOT NULL;

COMMIT;
