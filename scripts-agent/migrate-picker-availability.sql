-- Disponibilidad de pickers para el sistema de colas de alistamiento.
-- Idempotente: se puede ejecutar varias veces sin error.
-- BD: postgres/postgres@localhost:5432/ecommerce

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone;
