-- 26_erp_branch_price_outbox.sql
--
-- El ERP (TIDSAL) guarda un precio por (INSUC, INARTIC): un mismo artículo
-- puede costar distinto en cada sucursal. `prices` ya modela eso, pero hasta
-- ahora el único evento de outbox era `product_variants.current_price`
-- (un precio único que terminaba pisando TODAS las sucursales en el ERP).
--
-- Este trigger encola los cambios de `prices` con su `branch_id`, y
-- `push-catalog.mjs` los escribe con `... AND INSUC = <código de esa sucursal>`.
--
-- Anti ping-pong: igual que 21_erp_catalog_outbox.sql, los cambios que vienen
-- del pull (sync-catalog) corren con `SET app.erp_sync = 'on'` y no se encolan.

CREATE OR REPLACE FUNCTION erp_enqueue_branch_price() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sku text;
  v_key text;
BEGIN
  IF current_setting('app.erp_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Precio global (sin sucursal): no se empuja por esta vía; lo cubre el
  -- trigger de `product_variants` y se aplica a la sucursal primaria.
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.compare_price IS NOT DISTINCT FROM OLD.compare_price
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
    RETURN NEW;
  END IF;

  SELECT sku INTO v_sku
    FROM product_variants
   WHERE id = NEW.product_variant_id
   LIMIT 1;

  IF v_sku IS NULL THEN
    RETURN NEW;
  END IF;

  v_key := 'price:' || v_sku || ':' || NEW.branch_id || ':'
           || extract(epoch from clock_timestamp())::text;

  INSERT INTO erp_outbox (kind, idempotency_key, payload)
  VALUES (
    'price',
    v_key,
    jsonb_build_object(
      'sku', v_sku,
      'branch_id', NEW.branch_id,
      'price', NEW.price,
      'compare_price', NEW.compare_price
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_erp_branch_price ON prices;
CREATE TRIGGER trg_erp_branch_price
  AFTER INSERT OR UPDATE OF price, compare_price, end_date ON prices
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_branch_price();
