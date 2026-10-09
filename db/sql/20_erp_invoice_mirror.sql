-- 20_erp_invoice_mirror.sql
--
-- Espejo en Postgres de la FACTURACIÓN del ERP (Advantage) para que lo que
-- exista en el ERP exista también en Postgres.
--
-- OJO: NO son las tablas `invoices` / `payments` del e-commerce. Ésas son del
-- pedido web (`order_id NOT NULL`) y sólo sirven para *conciliar* nuestras
-- órdenes. La facturación del ERP (1,16 M facturas de POS/domicilio en 2026)
-- no está atada a nuestras órdenes, así que se guarda aquí 1:1.
--
-- El ERP es el dueño; estas tablas son de sólo lectura para el e-commerce y las
-- llena `scripts-agent/erp/sync-invoices.mjs` (diff por huella + row_hash).

CREATE TABLE IF NOT EXISTS erp_invoices (
  id             bigserial PRIMARY KEY,
  erp_key        text NOT NULL UNIQUE,     -- sucursal|ano|mes|factura
  row_hash       text NOT NULL,
  sucursal       text,
  ano            integer,
  mes            integer,
  factura        text,
  prefijo        text,
  tipo           text,               -- FA/CO/RE/AN/IN
  estado         text,
  fecha          integer,                  -- YYYYMMDD
  hora           text,
  vlr_bruto      numeric(14,2),
  vlr_descuento  numeric(14,2),
  vlr_iva        numeric(14,2),
  vlr_neto       numeric(14,2),
  total_pago     numeric(14,2),
  codigo_cliente text,
  nombre_cliente text,
  nit            text,
  telefono       text,
  email          text,
  ciudad         text,
  direccion      text,
  domicilio      text,              -- FADOMICIL: vínculo al pedido de domicilio
  domi_tipo      text,
  cufe           text,
  feid           text,
  obser1         text,
  obser2         text,
  medio_pago     text,
  synced_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erp_invoices_factura ON erp_invoices (factura);
CREATE INDEX IF NOT EXISTS idx_erp_invoices_domicilio
  ON erp_invoices (domicilio) WHERE domicilio IS NOT NULL AND domicilio <> '';
CREATE INDEX IF NOT EXISTS idx_erp_invoices_fecha ON erp_invoices (sucursal, fecha);

CREATE TABLE IF NOT EXISTS erp_payments (
  id         bigserial PRIMARY KEY,
  erp_key    text NOT NULL UNIQUE,         -- sucursal|ano|mes|auto|numero|factura|codigo|valor|fecha
  row_hash   text NOT NULL,
  sucursal   text,
  ano        integer,
  mes        integer,
  caja       text,
  fecha      integer,                      -- YYYYMMDD
  factura    text,
  codigo     text,                  -- medio de pago (POSPAGO)
  valor      numeric(14,2),
  iva        numeric(14,2),
  numero     text,
  tipo       text,
  cliente    text,
  auto       text,
  synced_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erp_payments_factura ON erp_payments (factura);
CREATE INDEX IF NOT EXISTS idx_erp_payments_fecha ON erp_payments (sucursal, fecha);
