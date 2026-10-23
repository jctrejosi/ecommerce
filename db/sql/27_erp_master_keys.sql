-- 27_erp_master_keys.sql
-- Llaves únicas por CÓDIGO ERP para que el pull de maestros pueda hacer
-- upsert por código (renombrar/actualizar) en vez de crear duplicados por nombre.
--
-- Son parciales (WHERE code IS NOT NULL AND deleted_at IS NULL) para no
-- chocar con las marcas/categorías locales que no tienen código ERP y para
-- permitir "revivir" una fila borrada lógicamente con el mismo código.

CREATE UNIQUE INDEX IF NOT EXISTS brands_code_uq
  ON brands (code) WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS categories_code_uq
  ON categories (code) WHERE code IS NOT NULL AND deleted_at IS NULL;
