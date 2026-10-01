-- 18_shelves_by_categories.sql
-- Las estanterías se organizan por VARIAS categorías (N:M) y dejan de tener
-- "filas": la ubicación de un producto pasa a ser solo la estantería.

BEGIN;

CREATE TABLE IF NOT EXISTS shelf_categories (
  shelf_id bigint NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (shelf_id, category_id)
);

-- Migra la categoría única que tuviera cada estantería.
INSERT INTO shelf_categories (shelf_id, category_id)
SELECT id, category_id FROM shelves WHERE category_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- La categoría pasa a la tabla intermedia.
ALTER TABLE shelves DROP COLUMN IF EXISTS category_id;

-- Las filas dejan de existir.
DROP TABLE IF EXISTS shelf_rows;

-- La ubicación del producto ya no tiene fila.
ALTER TABLE product_locations DROP COLUMN IF EXISTS row_number;

COMMIT;
