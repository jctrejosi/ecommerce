-- Borra las cuentas de prueba @demo.local (40 al 2026-11-04) manteniendo respaldo.
-- Uso (local):
--   docker exec -i ecommerce_postgres psql -U postgres -d ecommerce -f - < scripts-agent/delete-demo-customers.sql
-- Uso (servidor jcti):
--   ssh jcti 'docker exec -i ecommerce_postgres psql -U postgres -d ecommerce -f -' < scripts-agent/delete-demo-customers.sql
-- Los CSV quedan en /tmp dentro del contenedor; copiarlos con:
--   docker cp ecommerce_postgres:/tmp/demo-customers-backup.csv .
--
-- Dependencias verificadas (2026-11-04): 0 pedidos, 0 direcciones, 0 carritos,
-- 0 sesiones/tokens, 0 cupones, 0 eventos de entrega. Solo 8 notifications,
-- que se eliminan por CASCADE. orders.customer_id es RESTRICT: si una cuenta
-- demo tuviera pedidos, el DELETE falla entero (comportamiento deseado).
-- NO tocar cuentas reales del ERP: apellidos como DE MOYA / MONTES / DEMONTES
-- coinciden con el patrón "demo" pero no son cuentas de prueba.

\echo == respaldo
\copy (SELECT * FROM customers WHERE email ILIKE '%@demo.local' ORDER BY id) TO '/tmp/demo-customers-backup.csv' CSV HEADER
\copy (SELECT n.* FROM notifications n JOIN customers c ON c.id = n.target_customer_id WHERE c.email ILIKE '%@demo.local' ORDER BY n.id) TO '/tmp/demo-notifications-backup.csv' CSV HEADER

BEGIN;
DELETE FROM customers WHERE email ILIKE '%@demo.local';
COMMIT;

\echo == verificacion
SELECT count(*) AS demo_restantes FROM customers WHERE email ILIKE '%@demo.local';
SELECT count(*) AS total_customers FROM customers;
