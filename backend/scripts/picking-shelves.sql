-- Tablas del admin de picking (estanterías por sucursal)
-- Idempotente: seguro de ejecutar varias veces.
CREATE TABLE IF NOT EXISTS shelves (
  id bigserial PRIMARY KEY NOT NULL,
  branch_id bigint NOT NULL,
  code varchar(20) NOT NULL,
  name varchar(100) NOT NULL,
  type varchar(10) DEFAULT 'center' NOT NULL,
  color varchar(20) DEFAULT '#F59E0B' NOT NULL,
  width integer DEFAULT 3 NOT NULL,
  height integer DEFAULT 4 NOT NULL,
  pos_x integer DEFAULT 0 NOT NULL,
  pos_y integer DEFAULT 0 NOT NULL,
  rotation integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Columnas añadidas después de la creación inicial (tablas ya existentes)
ALTER TABLE shelves ADD COLUMN IF NOT EXISTS width integer DEFAULT 3 NOT NULL;
ALTER TABLE shelves ADD COLUMN IF NOT EXISTS height integer DEFAULT 4 NOT NULL;

-- Picker (usuario de picking) que alista cada pedido + quién hizo la transición
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picker_id bigint;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_at timestamptz;
ALTER TABLE order_status_history ADD COLUMN IF NOT EXISTS picker_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_picker_id_fkey') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_picker_id_fkey FOREIGN KEY (picker_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_status_history_picker_id_fkey') THEN
    ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_picker_id_fkey FOREIGN KEY (picker_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shelf_rows (
  id bigserial PRIMARY KEY NOT NULL,
  shelf_id bigint NOT NULL,
  row_number integer NOT NULL,
  label varchar(150) NOT NULL
);

CREATE TABLE IF NOT EXISTS product_locations (
  id bigserial PRIMARY KEY NOT NULL,
  product_variant_id bigint NOT NULL,
  branch_id bigint NOT NULL,
  shelf_id bigint NOT NULL,
  row_number integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shelves_branch_id_fkey') THEN
    ALTER TABLE shelves ADD CONSTRAINT shelves_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shelf_rows_shelf_id_fkey') THEN
    ALTER TABLE shelf_rows ADD CONSTRAINT shelf_rows_shelf_id_fkey FOREIGN KEY (shelf_id) REFERENCES shelves(id) ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_locations_product_variant_id_fkey') THEN
    ALTER TABLE product_locations ADD CONSTRAINT product_locations_product_variant_id_fkey FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_locations_branch_id_fkey') THEN
    ALTER TABLE product_locations ADD CONSTRAINT product_locations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_locations_shelf_id_fkey') THEN
    ALTER TABLE product_locations ADD CONSTRAINT product_locations_shelf_id_fkey FOREIGN KEY (shelf_id) REFERENCES shelves(id) ON DELETE cascade;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS product_locations_variant_branch_uq ON product_locations (product_variant_id, branch_id);
