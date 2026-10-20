-- 22_erp_outbox_masters.sql
--
-- Amplía la salida PG → ERP (Fase C) más allá de precio/stock: marcas,
-- categorías, tipos de producto, productos (nombre) y estado de pedido.
--
-- Los cambios hechos en el backend encolan en `erp_outbox` (payload = fila),
-- y `scripts-agent/erp/push-catalog.mjs` los escribe en el ERP.
--
-- Guardia anti ping-pong: `app.erp_sync='on'` (lo ponen los scripts de entrada
-- ERP→PG) hace que el trigger NO reencole lo que justamente trajimos del ERP.

CREATE OR REPLACE FUNCTION erp_enqueue_master() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind text := TG_TABLE_NAME;
  v_payload jsonb;
  v_key text;
BEGIN
  IF current_setting('app.erp_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- UPDATE sin cambios reales (ignorando marcas de tiempo): no encolar.
  IF TG_OP = 'UPDATE' AND
     (to_jsonb(NEW) - 'updated_at' - 'created_at') IS NOT DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'created_at') THEN
    RETURN NEW;
  END IF;

  v_payload := to_jsonb(NEW);
  v_key := v_kind || ':' || COALESCE(v_payload ->> 'id', '?') || ':'
           || extract(epoch from clock_timestamp())::text;
  INSERT INTO erp_outbox (kind, idempotency_key, payload)
  VALUES (v_kind, v_key, v_payload)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_erp_brands ON brands;
CREATE TRIGGER trg_erp_brands
  AFTER INSERT OR UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_master();

DROP TRIGGER IF EXISTS trg_erp_categories ON categories;
CREATE TRIGGER trg_erp_categories
  AFTER INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_master();

DROP TRIGGER IF EXISTS trg_erp_product_types ON product_types;
CREATE TRIGGER trg_erp_product_types
  AFTER INSERT OR UPDATE ON product_types
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_master();

DROP TRIGGER IF EXISTS trg_erp_products ON products;
CREATE TRIGGER trg_erp_products
  AFTER INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_master();

-- Estado del pedido → DOMDIA. Sólo cuando cambia `status` (no cuando se marca
-- como enviado). El mapeo estado→FAESTADO se resuelve en el drenador.
CREATE OR REPLACE FUNCTION erp_enqueue_order_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.erp_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO erp_outbox (kind, idempotency_key, payload)
  VALUES ('order_status',
          'order_status:' || NEW.id || ':' || extract(epoch from clock_timestamp())::text,
          jsonb_build_object('id', NEW.id, 'reference_code', NEW.reference_code, 'status', NEW.status))
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_erp_order_status ON orders;
CREATE TRIGGER trg_erp_order_status
  AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION erp_enqueue_order_status();

CREATE INDEX IF NOT EXISTS idx_erp_outbox_pending2
  ON erp_outbox (id) WHERE status = 'pending';
