-- 04_delivery_auth.sql
-- Vincula cada repartidor (delivery_drivers) con su cuenta de acceso (users),
-- reutilizando el sistema de login/JWT/refresh ya existente para staff.
BEGIN;

ALTER TABLE delivery_drivers
  ADD COLUMN IF NOT EXISTS auth_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_drivers_auth_user
  ON delivery_drivers (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

COMMIT;
