-- 21_erp_catalog_outbox.sql
--
-- Fase C (docs/PLAN-SINCRONIZACION-ERP.md): permitir que un cambio hecho en el
-- backend (precio / stock) se propague al ERP.
--
-- Cómo: triggers en `product_variants` e `inventory` que ENCOLAN el cambio en
-- `erp_outbox` (kind='price' / 'stock'). El agente lo drena con
-- `scripts-agent/erp/push-catalog.mjs` y escribe en `TIDSAL`.
--
-- Anti ping-pong: los scripts de entrada ERP→PG (sync-catalog) hacen
-- `SET app.erp_sync = 'on'`; el trigger se salta esos cambios para no devolver
-- al ERP lo que justamente acabamos de traer de él.

CREATE OR REPLACE FUNCTION erp_enqueue_catalog() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_payload jsonb;
  v_key text;
BEGIN
  -- Cambios originados por la propia sincronización ERP→PG: no reencolar.
  IF current_setting('app.erp_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'product_variants' THEN
    IF TG_OP = 'UPDATE'
       AND NEW.current_price IS NOT DISTINCT FROM OLD.current_price
       AND NEW.current_compare_price IS NOT DISTINCT FROM OLD.current_compare_price THEN
      RETURN NEW;
    END IF;
    v_payload := jsonb_build_object(
      'sku', NEW.sku,
      'price', NEW.current_price,
      'compare_price', NEW.current_compare_price
    );
    v_key := 'price:' || NEW.sku || ':' || extract(epoch from clock_timestamp())::text;
    INSERT INTO erp_outbox (kind, idempotency_key, payload)
    VALUES ('price', v_key, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF TG_TABLE_NAME = 'inventory' THEN
    IF TG_OP = 'UPDATE' AND NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
      RETURN NEW;
    END IF;
    v_payload := jsonb_build_object(
      'variant_id', NEW.product_variant_id,
      'branch_id', NEW.branch_id,
      'stock', NEW.stock
    );
    v_key := 'stock:' || NEW.product_variant_id || ':' || NEW.branch_id || ':'
             || extract(epoch from clock_timestamp())::text;
    INSERT INTO erp_outbox (kind, idempotency_key, payload)
    VALUES ('stock', v_key, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_erp_price ON product_variants;
CREATE TRIGGER trg_erp_price
  AFTER INSERT OR UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_catalog();

DROP TRIGGER IF EXISTS trg_erp_stock ON inventory;
CREATE TRIGGER trg_erp_stock
  AFTER INSERT OR UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_catalog();

CREATE INDEX IF NOT EXISTS idx_erp_outbox_pending
  ON erp_outbox (kind, id) WHERE status = 'pending';
