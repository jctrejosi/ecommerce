-- 25_erp_product_outbox.sql
--
-- Encola cambios de producto que NO pasan por la fila `products`:
--
--   product_type_assignments            → kind 'products'       (cambia INTIPO)
--   product_categories                  → kind 'products'       (refresca el producto)
--   product_attributes (campos ERP)      → kind 'products'       (nombre corto/largo, INCATE...)
--   product_variants.barcode/dimensiones → kind 'products'      (cambia INEAN/INALTO/ANCHO/LARGO)
--   products.is_active                  → kind 'product_flags'  (cambia INACTIVO)
--   product_variants.is_active          → kind 'product_flags'  (cambia INACTIVO)
--
-- `push-catalog.mjs` drena ambos kinds contra TIDSAL. El catálogo sigue siendo
-- del ERP: no se crean artículos, sólo se actualizan los que ya existen por SKU.

CREATE OR REPLACE FUNCTION erp_enqueue_product_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pid bigint;
  aid bigint;
BEGIN
  IF current_setting('app.erp_sync', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    pid := OLD.product_id;
    IF TG_TABLE_NAME = 'product_attributes' THEN aid := OLD.attribute_id; END IF;
  ELSE
    pid := NEW.product_id;
    IF TG_TABLE_NAME = 'product_attributes' THEN aid := NEW.attribute_id; END IF;
  END IF;

  -- Sólo los atributos que se escriben en TIDSAL; el resto (color, talla...)
  -- no debe generar tráfico hacia el ERP.
  IF TG_TABLE_NAME = 'product_attributes' THEN
    IF TG_OP = 'UPDATE'
       AND NEW.attribute_id IS NOT DISTINCT FROM OLD.attribute_id
       AND NEW.custom_value IS NOT DISTINCT FROM OLD.custom_value
       AND NEW.attribute_option_id IS NOT DISTINCT FROM OLD.attribute_option_id THEN
      RETURN NEW;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM attributes
       WHERE id = aid
         AND slug IN ('nombre-corto', 'nombre-largo', 'categoria-erp',
                      'unidad-medida', 'presentacion', 'unidades-empaque',
                      'referencia-fabricante', 'registro-invima', 'cum',
                      'ubicacion-bodega', 'ean-caja')
    ) THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
  END IF;

  IF pid IS NOT NULL THEN
    INSERT INTO erp_outbox (kind, idempotency_key, payload)
    VALUES ('products',
            'products:' || pid || ':' || extract(epoch from clock_timestamp())::text,
            jsonb_build_object('id', pid, 'source', TG_TABLE_NAME))
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

DROP TRIGGER IF EXISTS trg_erp_product_type_assignments ON product_type_assignments;
CREATE TRIGGER trg_erp_product_type_assignments
  AFTER INSERT OR UPDATE OR DELETE ON product_type_assignments
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_product_event();

DROP TRIGGER IF EXISTS trg_erp_product_categories ON product_categories;
CREATE TRIGGER trg_erp_product_categories
  AFTER INSERT OR UPDATE OR DELETE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_product_event();

DROP TRIGGER IF EXISTS trg_erp_product_attributes ON product_attributes;
CREATE TRIGGER trg_erp_product_attributes
  AFTER INSERT OR UPDATE OR DELETE ON product_attributes
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_product_event();

DROP TRIGGER IF EXISTS trg_erp_variant_attrs ON product_variants;
CREATE TRIGGER trg_erp_variant_attrs
  AFTER UPDATE OF barcode, length_mm, width_mm, height_mm ON product_variants
  FOR EACH ROW
  WHEN (
    NEW.barcode    IS DISTINCT FROM OLD.barcode
    OR NEW.length_mm IS DISTINCT FROM OLD.length_mm
    OR NEW.width_mm  IS DISTINCT FROM OLD.width_mm
    OR NEW.height_mm IS DISTINCT FROM OLD.height_mm
  )
  EXECUTE FUNCTION erp_enqueue_product_event();

CREATE OR REPLACE FUNCTION erp_enqueue_product_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pid bigint;
  active boolean;
BEGIN
  IF current_setting('app.erp_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'products' THEN
    pid := NEW.id;
  ELSE
    pid := NEW.product_id;
  END IF;
  active := NEW.is_active;

  INSERT INTO erp_outbox (kind, idempotency_key, payload)
  VALUES ('product_flags',
          'product_flags:' || pid || ':' || extract(epoch from clock_timestamp())::text,
          jsonb_build_object('id', pid, 'is_active', active, 'source', TG_TABLE_NAME))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_erp_product_flags ON products;
CREATE TRIGGER trg_erp_product_flags
  AFTER UPDATE OF is_active ON products
  FOR EACH ROW
  WHEN (NEW.is_active IS DISTINCT FROM OLD.is_active)
  EXECUTE FUNCTION erp_enqueue_product_flags();

DROP TRIGGER IF EXISTS trg_erp_variant_flags ON product_variants;
CREATE TRIGGER trg_erp_variant_flags
  AFTER UPDATE OF is_active ON product_variants
  FOR EACH ROW
  WHEN (NEW.is_active IS DISTINCT FROM OLD.is_active)
  EXECUTE FUNCTION erp_enqueue_product_flags();
