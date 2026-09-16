-- 14_picker_chat.sql
-- Chat directo picker ↔ administrador (un hilo por picker).
--
-- Es el equivalente de `driver_chat_messages` para el picking: sirve para
-- coordinar novedades con el panel y queda guardado aunque no haya pedidos.
-- `picker_id` apunta a `users` porque el picker es un usuario del sistema
-- (marcado con `is_picker`), no una entidad aparte.
BEGIN;

DO $$
BEGIN
  CREATE TYPE picker_chat_sender_enum AS ENUM ('picker', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS picker_chat_messages (
  id bigserial PRIMARY KEY,
  picker_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_type picker_chat_sender_enum NOT NULL,
  sender_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

-- Lectura del hilo completo en orden cronológico.
CREATE INDEX IF NOT EXISTS idx_picker_chat_messages_picker
  ON picker_chat_messages (picker_id, id);

-- Contador de no leídos (parcial: solo lo pendiente).
CREATE INDEX IF NOT EXISTS idx_picker_chat_messages_unread
  ON picker_chat_messages (picker_id)
  WHERE read_at IS NULL;

COMMIT;
