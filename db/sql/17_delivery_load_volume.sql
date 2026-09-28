-- 17_delivery_load_volume.sql
-- Volumen de carga por pedido y capacidad del vehículo (solo volumen).
--
-- Objetivo: poder contrastar lo que ocupa un pedido con lo que cabe en cada
-- vehículo, para planificar rutas con más de un pedido por repartidor.
--
--   * `delivery_drivers.cargo_volume_cm3` → capacidad declarada del vehículo.
--     NULL = sin capacidad declarada (no se le puede validar el cupo).
--   * `shipments.total_volume_cm3` → snapshot del volumen del pedido, calculado
--     a partir de `order_items` × dimensiones de `product_variants`. Se guarda
--     para no recalcular en cada listado y para que el histórico no cambie si
--     luego se editan las dimensiones del catálogo.
--   * `shipments.volume_estimated` → true cuando algún ítem no tenía las tres
--     dimensiones y se usó el volumen de respaldo (el dato es aproximado).
--
-- Unidades: cm³ en la BD, litros en la UI (1 L = 1000 cm³). Aún sin peso.
BEGIN;

ALTER TABLE delivery_drivers
  ADD COLUMN IF NOT EXISTS cargo_volume_cm3 integer;

-- Una capacidad declarada debe ser positiva (NULL sigue permitido).
ALTER TABLE delivery_drivers
  DROP CONSTRAINT IF EXISTS delivery_drivers_cargo_volume_cm3_check;
ALTER TABLE delivery_drivers
  ADD CONSTRAINT delivery_drivers_cargo_volume_cm3_check
  CHECK (cargo_volume_cm3 IS NULL OR cargo_volume_cm3 > 0);

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS total_volume_cm3 integer;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS volume_estimated boolean NOT NULL DEFAULT false;

ALTER TABLE shipments
  DROP CONSTRAINT IF EXISTS shipments_total_volume_cm3_check;
ALTER TABLE shipments
  ADD CONSTRAINT shipments_total_volume_cm3_check
  CHECK (total_volume_cm3 IS NULL OR total_volume_cm3 >= 0);

COMMIT;
