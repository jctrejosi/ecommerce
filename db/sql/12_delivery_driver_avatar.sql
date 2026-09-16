-- 12_delivery_driver_avatar.sql
-- Foto de perfil del repartidor.
--
-- Se sube desde la app (pantalla Perfil), el archivo va a Cloudinary y aquí
-- solo se persiste la URL pública (`secure_url`) para mostrarla en la app y en
-- el panel de flota.
BEGIN;

ALTER TABLE delivery_drivers
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMIT;
