-- 23_erp_order_status_map.sql
--
-- 1) Relaja la PK de `erp_code_map` para permitir varios `canonical` apuntando
--    a un mismo código ERP (necesario en el dominio `order_status`: varios
--    estados del ecommerce comparten el mismo FAESTADO). La tabla ya era
--    muchos-a-uno en la otra dirección (varias marcas → un mismo nombre), pero
--    la PK `(domain, erp_value)` impedía repetir un código. La nueva PK
--    `(domain, erp_value, canonical)` es equivalente para el resto de dominios
--    (donde cada `erp_value` tiene un único `canonical`).
--
-- 2) Siembra el mapa de estados de pedido ecommerce → DOMDIA.FAESTADO, que
--    consume `scripts-agent/erp/push-catalog.mjs` (kind `order_status`).
--
-- ⚠️ PROVISIONAL: los códigos reales de FAESTADO los confirma el ERP en sitio.
--    Observado en la copia `ADD_ANALITICA`:
--      '9' → 50.758 filas (casi todas con FAPEDIDO)  → facturado / cerrado
--      '5' →    389 filas (algunas con FAPEDIDO)      → en curso / pend. facturar
--      '0' →    134 filas (sin FAPEDIDO)              → anulado
--      ''  →  1.303 filas                             → sin estado
--
-- Ajusta/agrega filas aquí (o con UPDATE a `erp_code_map`) sin tocar el código:
--   domain = 'order_status', erp_value = código ERP, canonical = estado ecommerce.
--
-- ON CONFLICT DO NOTHING: no pisa correcciones manuales posteriores.

ALTER TABLE erp_code_map DROP CONSTRAINT IF EXISTS erp_code_map_pkey;
ALTER TABLE erp_code_map
  ADD CONSTRAINT erp_code_map_pkey PRIMARY KEY (domain, erp_value, canonical);

INSERT INTO erp_code_map (domain, erp_value, canonical, label) VALUES
  ('order_status', '9', 'delivered', 'Entregado / facturado (provisional)'),
  ('order_status', '5', 'preparing', 'En preparación (provisional)'),
  ('order_status', '5', 'ready',     'Listo / alistado (provisional)'),
  ('order_status', '5', 'shipped',   'Despachado / en ruta (provisional)'),
  ('order_status', '0', 'cancelled', 'Anulado (provisional)'),
  ('order_status', '0', 'refunded',  'Reembolsado / anulado (provisional)')
ON CONFLICT (domain, erp_value, canonical) DO NOTHING;
