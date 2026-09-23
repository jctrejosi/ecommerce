-- 15_user_avatar.sql
-- Foto de perfil de los usuarios de staff (pickers).
--
-- Se sube desde la app móvil de picking (botón del usuario → cambiar foto), el
-- archivo va a Cloudinary y aquí solo se persiste la URL pública para mostrarla
-- en la app y en el panel de picking admin.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMIT;
