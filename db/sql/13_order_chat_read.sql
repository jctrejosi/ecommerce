-- 13_order_chat_read.sql
-- Visto (acuse de lectura) en el chat por pedido: cliente ↔ repartidor.
--
-- Se sella `read_at` cuando la CONTRAPARTE lee el mensaje, no cuando lo escribe
-- quien lo envió. Como el chat es de dos partes, una sola columna basta:
--   - el repartidor marca leídos los mensajes `sender_type = 'customer'`
--   - el cliente marca leídos los mensajes `sender_type = 'delivery'`
--
-- Con eso el emisor ve el doble check en sus propios mensajes y la contraparte
-- obtiene además el conteo de no leídos. Mismo patrón que
-- `driver_chat_messages` (11_driver_chat.sql), que ya usa `read_at`.
BEGIN;

ALTER TABLE order_chat_messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Conteo rápido de no leídos por pedido (badge del chat).
CREATE INDEX IF NOT EXISTS idx_order_chat_messages_unread
  ON order_chat_messages USING btree (order_id)
  WHERE read_at IS NULL;

COMMIT;
