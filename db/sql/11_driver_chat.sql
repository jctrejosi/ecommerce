-- 11_driver_chat.sql
-- Chat directo repartidor ↔ administrador (panel web delivery admin).
--
-- Es un hilo por repartidor (no por pedido): sirve para la coordinación
-- operativa (novedades, direcciones, incidencias) y queda guardado como
-- historial aunque no haya un pedido en curso.
--
-- Diferencias con `order_chat_messages` (cliente ↔ repartidor):
--   - `order_chat_messages` cuelga de `orders` (se borra con el pedido) y solo
--     se escribe mientras la entrega está en camino.
--   - `driver_chat_messages` cuelga de `delivery_drivers` y está siempre
--     disponible mientras el repartidor exista.
BEGIN;

DO $$
BEGIN
  CREATE TYPE driver_chat_sender_enum AS ENUM ('driver', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS driver_chat_messages (
  id bigserial PRIMARY KEY,
  driver_id bigint NOT NULL REFERENCES delivery_drivers(id) ON DELETE CASCADE,
  sender_type driver_chat_sender_enum NOT NULL,
  -- Quién escribió: el admin (users.id) o la cuenta de acceso del repartidor.
  sender_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Se sella cuando la contraparte lee el hilo: alimenta los badges de no leídos.
  read_at timestamptz
);

-- Lectura del hilo completo de un repartidor (orden cronológico).
CREATE INDEX IF NOT EXISTS idx_driver_chat_messages_driver
  ON driver_chat_messages USING btree (driver_id, id);

-- Conteo rápido de no leídos por repartidor.
CREATE INDEX IF NOT EXISTS idx_driver_chat_messages_unread
  ON driver_chat_messages USING btree (driver_id)
  WHERE read_at IS NULL;

COMMIT;
