-- Promociones dinámicas: descuento base, días y reglas de alcance.
BEGIN;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS discount_type varchar(20) NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS discount_value numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maximum_discount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS weekdays integer[];

ALTER TABLE promotion_products
  ALTER COLUMN discount_value DROP NOT NULL;

CREATE TABLE IF NOT EXISTS promotion_categories (
  promotion_id bigint NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_categories_category
  ON promotion_categories (category_id);

CREATE TABLE IF NOT EXISTS promotion_combos (
  id bigserial PRIMARY KEY,
  promotion_id bigint NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  name varchar(100),
  mode varchar(20) NOT NULL DEFAULT 'same_discount',
  quantity_required integer NOT NULL DEFAULT 2,
  discount_value numeric(12, 2) NOT NULL DEFAULT 0,
  is_percentage boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_combos_quantity_check CHECK (quantity_required >= 2)
);

CREATE INDEX IF NOT EXISTS idx_promotion_combos_promotion
  ON promotion_combos (promotion_id);

CREATE TABLE IF NOT EXISTS promotion_combo_items (
  id bigserial PRIMARY KEY,
  combo_id bigint NOT NULL REFERENCES promotion_combos(id) ON DELETE CASCADE,
  product_variant_id bigint NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  discount_value numeric(12, 2) NOT NULL DEFAULT 0,
  is_percentage boolean NOT NULL DEFAULT true,
  CONSTRAINT promotion_combo_items_combo_variant_key
    UNIQUE (combo_id, product_variant_id)
);

COMMIT;
