-- ============================================================
-- 19_erp_integration.sql
-- Tablas de integración con el ERP Advantage (.adt).
-- Piloto: contra la copia db/ADD_ANALITICA servida por OpenADS.
-- Idempotente: se puede aplicar varias veces.
-- ============================================================

-- 1. Log crudo de eventos/lecturas del ERP (inmutable, idempotente)
CREATE TABLE IF NOT EXISTS erp_events (
  id           bigserial PRIMARY KEY,
  erp_table    text NOT NULL,
  erp_event_id bigint NOT NULL,
  op           char(1) NOT NULL,
  erp_key      text NOT NULL,
  payload      jsonb,
  status       text NOT NULL DEFAULT 'pending',  -- pending|applied|error|skipped
  error        text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz,
  UNIQUE (erp_table, erp_event_id)
);

-- 2. Diccionario de códigos del ERP (nada se interpreta con un if)
CREATE TABLE IF NOT EXISTS erp_code_map (
  domain    text NOT NULL,   -- payment_method|invoice_type|city|warehouse|brand|product_type|tax...
  erp_value text NOT NULL,
  canonical text NOT NULL,
  label     text,
  meta      jsonb,
  PRIMARY KEY (domain, erp_value)
);

-- 3. Identidad cruzada ERP <-> Postgres
CREATE TABLE IF NOT EXISTS erp_ref (
  entity     text NOT NULL,   -- product|variant|customer|order|invoice|payment
  local_id   bigint NOT NULL,
  erp_table  text NOT NULL,
  erp_key    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, local_id, erp_table),
  UNIQUE (erp_table, erp_key)
);

-- 4. Outbox: transacciones que salen hacia el ERP (pedidos, clientes)
CREATE TABLE IF NOT EXISTS erp_outbox (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL,                       -- order|customer
  idempotency_key text NOT NULL UNIQUE,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending',     -- pending|sent|ack|error
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  erp_ref         text,                                -- FAPEDIDO / FAFACTURA devuelto
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  acked_at        timestamptz
);

-- 5. Watermark de consumo
CREATE TABLE IF NOT EXISTS erp_sync_cursor (
  source        text PRIMARY KEY,
  last_event_id bigint,
  last_run_at   timestamptz,
  last_hash     text
);

-- 6. Huellas para detectar cambios (diff con hash)
CREATE TABLE IF NOT EXISTS erp_snapshot (
  erp_table      text NOT NULL,
  erp_key        text NOT NULL,
  hash           text NOT NULL,
  erp_updated_at timestamptz,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (erp_table, erp_key)
);

-- 7. Cuarentena
CREATE TABLE IF NOT EXISTS erp_dlq (
  id         bigserial PRIMARY KEY,
  erp_table  text,
  erp_key    text,
  payload    jsonb,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Bitácora de corridas
CREATE TABLE IF NOT EXISTS erp_sync_runs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,      -- catalog|codes|order|reconcile
  direction   text,               -- in|out
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  read_count  int DEFAULT 0,
  changed     int DEFAULT 0,
  applied     int DEFAULT 0,
  failed      int DEFAULT 0,
  notes       text
);

-- Columnas de correlación en tablas existentes
ALTER TABLE customers ADD COLUMN IF NOT EXISTS erp_customer_code text;
ALTER TABLE orders    ADD COLUMN IF NOT EXISTS erp_document_ref  text;
ALTER TABLE orders    ADD COLUMN IF NOT EXISTS erp_sync_status   text;

CREATE UNIQUE INDEX IF NOT EXISTS customers_erp_customer_code_uq
  ON customers (erp_customer_code) WHERE erp_customer_code IS NOT NULL;

SELECT 'erp integration: tablas listas' AS resultado;
