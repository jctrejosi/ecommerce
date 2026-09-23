-- 16_users_push_token.sql
-- Token FCM del dispositivo de los usuarios de staff (pickers).
--
-- Lo registra la app móvil de picking al iniciar sesión, para que el backend
-- pueda mandar notificaciones push (FCM) cuando entra un pedido nuevo o cuando
-- administración escribe en el chat. Mismo mecanismo que `customers.push_token`
-- y `delivery_drivers.push_token`.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_token text;

COMMIT;
