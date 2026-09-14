-- Chat por pedido: mensajes entre el repartidor y el cliente de un pedido.
-- sender_type distingue quién escribió; la identidad concreta se guarda en
-- sender_user_id (cuenta users del repartidor o cliente registrado) o
-- sender_guest_session_id (cliente invitado).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_chat_sender_enum') THEN
    CREATE TYPE order_chat_sender_enum AS ENUM ('customer', 'delivery');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS order_chat_messages (
  id bigserial PRIMARY KEY NOT NULL,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_type order_chat_sender_enum NOT NULL,
  sender_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  sender_guest_session_id bigint REFERENCES guest_sessions(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_chat_messages_order
  ON order_chat_messages (order_id);
