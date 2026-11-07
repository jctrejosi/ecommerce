-- 24_erp_code_map_fortuner.sql
--
-- Corrige `erp_code_map` con los códigos reales de FORTUNER (C:\ADD_FORTUNER).
-- Sustituye la semilla provisional de la migración 23 y limpia los dominios que
-- quedaron corruptos al leer tablas equivocadas de la copia local:
--
--   city           : 1.647 filas con EAN/nombres de producto. POSDANE no es un
--                    diccionario de ciudades; DOMDIA.FACIUDAD es texto libre.
--   tax            : se cargaron las 56 clases de TIDTIPOS (UM, TI, TP, TR).
--                    Sólo CLASE='IM' son impuestos.
--   payment_method : canonical era el nombre del ERP, no el enum del ecommerce.
--
-- Evidencia (ver docs/ESCRITURA-FORTUNER-READINESS.md):
--   DOMDIA.FAESTADO  0=pendiente, 5=cancelado (FAOBSER "CANCELADO", totales 0),
--                    9=facturado/entregado.
--   DOMITE.IFESTADO  32768=normal, 5=cancelado.
--   TIDSAL.INTIMP    J=19 %, C=5 %, E=0 %, B=impuesto bolsa.
--   DOMITE.IFTIMP    vacío en el 100 % de las filas; se usa IFPORIVA.
--   TIDSAL.INBODEGA  '00' en las 51.938 filas: bodega consolidada.
--   DOMDIA.FAVLRFLE  vacío; el domicilio va en FAVARIOS.
--
-- Es idempotente: conserva los diccionarios completos que agrega
-- `scripts-agent/erp/sync-codes.mjs` y sólo corrige/upserta los códigos base.

BEGIN;

-- ── Limpieza de semillas corruptas ──────────────────────────────────────────
-- Ciudad: no hay fuente. La única fila válida sería texto libre en DOMDIA.
DELETE FROM erp_code_map WHERE domain = 'city';

-- Pagos: las filas corruptas usaban el nombre del ERP como `canonical`
-- ("EFECTIVO"). Se conservan las filas de diccionario (canonical = código).
DELETE FROM erp_code_map
 WHERE domain = 'payment_method'
   AND canonical NOT IN ('CASH', 'CARD', 'PSE', 'BANK_TRANSFER', 'NEQUI', 'DAVIPLATA', 'BREB')
   AND canonical <> erp_value;

-- Impuestos: las filas corruptas usaban la descripción como `canonical`
-- ("UM-AR", "IVA 19%"). Se conservan las de diccionario (canonical = TIPO) y
-- las de tarifa (canonical numérico).
DELETE FROM erp_code_map
 WHERE domain = 'tax'
   AND canonical <> erp_value
   AND canonical !~ '^[0-9]+([.][0-9]+)?$';

-- ── Estados de pedido ecommerce → DOMDIA.FAESTADO ───────────────────────────
DELETE FROM erp_code_map WHERE domain = 'order_status';
INSERT INTO erp_code_map (domain, erp_value, canonical, label) VALUES
  ('order_status', '0', 'created',         'Pendiente en ERP'),
  ('order_status', '0', 'payment_pending', 'Pendiente en ERP'),
  ('order_status', '0', 'paid',            'Pendiente en ERP'),
  ('order_status', '0', 'preparing',       'Pendiente en ERP'),
  ('order_status', '0', 'ready',           'Pendiente en ERP'),
  ('order_status', '0', 'shipped',         'Pendiente en ERP'),
  ('order_status', '5', 'cancelled',       'Cancelado'),
  ('order_status', '5', 'refunded',        'Cancelado'),
  ('order_status', '9', 'delivered',       'Facturado / entregado');

-- ── Medios de pago ecommerce → POSPAGO.CODIGO ───────────────────────────────
INSERT INTO erp_code_map (domain, erp_value, canonical, label) VALUES
  ('payment_method', 'EF', 'CASH',          'EFECTIVO'),
  ('payment_method', 'TC', 'CARD',          'TARJETA CREDITO'),
  ('payment_method', 'TF', 'PSE',           'TRANSFERENCIA BANCARIA'),
  ('payment_method', 'TF', 'BANK_TRANSFER', 'TRANSFERENCIA BANCARIA'),
  ('payment_method', 'TF', 'NEQUI',         'TRANSFERENCIA BANCARIA'),
  ('payment_method', 'TF', 'DAVIPLATA',     'TRANSFERENCIA BANCARIA'),
  ('payment_method', 'TF', 'BREB',          'TRANSFERENCIA BANCARIA')
ON CONFLICT (domain, erp_value, canonical) DO UPDATE
  SET label = EXCLUDED.label;

-- ── Tarifas de IVA (%) → TIDTIPOS.TIPO (CLASE='IM') ────────────────────────
INSERT INTO erp_code_map (domain, erp_value, canonical, label, meta) VALUES
  ('tax', 'E', '0',  'EXCLUIDO',       '{"rate":0,"clase":"IM"}'),
  ('tax', 'C', '5',  'IVA 5%',         '{"rate":5,"clase":"IM"}'),
  ('tax', 'P', '8',  'IMP CONSUMO 8%', '{"rate":8,"clase":"IM"}'),
  ('tax', 'S', '10', 'IVA 10%',        '{"rate":10,"clase":"IM"}'),
  ('tax', 'I', '16', 'IVA 16%',        '{"rate":16,"clase":"IM"}'),
  ('tax', 'J', '19', 'IVA 19%',        '{"rate":19,"clase":"IM"}'),
  ('tax', 'V', '20', 'IVA 20%',        '{"rate":20,"clase":"IM"}'),
  ('tax', 'T', '35', 'IVA 35%',        '{"rate":35,"clase":"IM"}')
ON CONFLICT (domain, erp_value, canonical) DO UPDATE
  SET label = EXCLUDED.label, meta = EXCLUDED.meta;

-- ── Bodegas de las 3 sucursales del ecommerce (TIDBODE) ────────────────────
INSERT INTO erp_code_map (domain, erp_value, canonical, label) VALUES
  ('warehouse', '01', '01', 'CENTRO'),
  ('warehouse', '02', '02', 'SULTANA'),
  ('warehouse', '11', '11', 'PALERMO')
ON CONFLICT (domain, erp_value, canonical) DO UPDATE
  SET label = EXCLUDED.label;

COMMIT;
