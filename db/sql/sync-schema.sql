-- sync-schema.sql — drift ADITIVO entre backend/drizzle/schema.ts y la BD.
--
-- Lo aplica `dev.js` (función `syncDbSchema`) en `--init` y tras restaurar un
-- respaldo, para que el backend no muera con "column does not exist" cuando el
-- respaldo versionado es más antiguo que el modelo Drizzle.
--
-- Reglas:
--   * SOLO sentencias aditivas e idempotentes (IF NOT EXISTS). NUNCA droppear.
--   * No usar `drizzle-kit push` para esto: borra tablas/columnas/secuencias
--     del ERP (db/sql/19..27, p. ej. `erp_*`, `orders.erp_sync_status`) que no
--     están en schema.ts. `push` asume que posee TODO el schema `public`.

-- Login (admin/picking): `users` ganó estas columnas después del respaldo
-- versionado. Sin ellas el SELECT de auth falla en la primera columna ausente.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
