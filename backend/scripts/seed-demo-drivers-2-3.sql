-- Repartidores demo adicionales (demo2, demo3) con un pedido en camino cada uno.
-- Idempotente: usa ON CONFLICT / NOT EXISTS para poder ejecutarse varias veces.
--
-- Credenciales de acceso (app móvil): demo2 / demo1234 y demo3 / demo1234
-- (reutilizan el mismo hash bcrypt que el usuario `demo`).

BEGIN;

-- 1) Cuentas de acceso ------------------------------------------------------
INSERT INTO users (email, username, password_hash, first_name, last_name, phone, is_superuser, is_active)
SELECT v.email, v.username,
       '$2b$10$SfjhuSxCco53WZKbMU7m8ush3uxpCdryewMn4dgqEZBEcTKdryb0W',
       v.first_name, 'Repartidor', v.phone, false, true
FROM (VALUES
  ('demo2@mercaldas.com.co', 'demo2', 'Demo2', '3000000002'),
  ('demo3@mercaldas.com.co', 'demo3', 'Demo3', '3000000003')
) AS v(email, username, first_name, phone)
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.username = v.username
);

-- 2) Perfiles de repartidor -------------------------------------------------
INSERT INTO delivery_drivers
  (full_name, phone, email, auth_user_id, vehicle_type, vehicle_plate, route_color,
   current_location, last_location_at, is_available, is_active)
SELECT 'Demo Repartidor 2', '3000000002', 'demo2@mercaldas.com.co', u.id,
       'MOTO', 'ABC12D', '#DC2626', 'POINT(-75.5005 5.0588)', now(), true, true
FROM users u
WHERE u.username = 'demo2'
  AND NOT EXISTS (
    SELECT 1 FROM delivery_drivers d WHERE d.auth_user_id = u.id
  );

INSERT INTO delivery_drivers
  (full_name, phone, email, auth_user_id, vehicle_type, vehicle_plate, route_color,
   current_location, last_location_at, is_available, is_active)
SELECT 'Demo Repartidor 3', '3000000003', 'demo3@mercaldas.com.co', u.id,
       'MOTO', 'XYZ34E', '#059669', 'POINT(-75.4720 5.0395)', now(), true, true
FROM users u
WHERE u.username = 'demo3'
  AND NOT EXISTS (
    SELECT 1 FROM delivery_drivers d WHERE d.auth_user_id = u.id
  );

-- 3) Pedidos ----------------------------------------------------------------
INSERT INTO orders
  (reference_code, customer_id, branch_id, status, currency_code,
   subtotal, shipping_cost, grand_total, customer_name, customer_phone, notes,
   created_at, updated_at)
VALUES
  ('MER-04924968', 1, 1, 'shipped', 'COP', 16400.00, 4900.00, 21300.00,
   'Ana Gómez', '3001112233', 'Casa esquinera, timbre azul.', now(), now()),
  ('MER-04924969', 1, 1, 'shipped', 'COP', 11700.00, 4900.00, 16600.00,
   'Luis Pérez', '3004445566', 'Entregar en portería.', now(), now())
ON CONFLICT (reference_code) DO NOTHING;

-- 4) Envíos (destino del cliente) -------------------------------------------
INSERT INTO shipments
  (order_id, address_line1, address_line2, city, location, recipient_name,
   recipient_phone, status, created_at, updated_at)
SELECT o.id, 'Cra 30 # 55-40', 'Casa', 'Manizales',
       'POINT(-75.5260 5.0460)', 'Ana Gómez', '3001112233', 'IN_TRANSIT', now(), now()
FROM orders o
WHERE o.reference_code = 'MER-04924968'
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id);

INSERT INTO shipments
  (order_id, address_line1, address_line2, city, location, recipient_name,
   recipient_phone, status, created_at, updated_at)
SELECT o.id, 'Calle 65 # 12-30', 'Apto 501', 'Manizales',
       'POINT(-75.4965 5.0210)', 'Luis Pérez', '3004445566', 'IN_TRANSIT', now(), now()
FROM orders o
WHERE o.reference_code = 'MER-04924969'
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id);

-- 5) Ítems de pedido --------------------------------------------------------
INSERT INTO order_items
  (order_id, product_variant_id, product_name, quantity, unit_price_net,
   unit_price_gross, subtotal, total, picked_qty, created_at)
SELECT o.id, v.variant_id, v.name, v.qty, v.price, v.price, v.price * v.qty,
       v.price * v.qty, v.qty, now()
FROM orders o
CROSS JOIN (VALUES
  (10386, 'ARVEJAS/ZANAHORIA ZENU 355GR LA', 1, 8900.00),
  (10388, 'ARVEJA ZENU NATURAL 355GR LA', 1, 7500.00)
) AS v(variant_id, name, qty, price)
WHERE o.reference_code = 'MER-04924968'
  AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id);

INSERT INTO order_items
  (order_id, product_variant_id, product_name, quantity, unit_price_net,
   unit_price_gross, subtotal, total, picked_qty, created_at)
SELECT o.id, v.variant_id, v.name, v.qty, v.price, v.price, v.price * v.qty,
       v.price * v.qty, v.qty, now()
FROM orders o
CROSS JOIN (VALUES
  (10386, 'ARVEJAS/ZANAHORIA ZENU 355GR LA', 1, 8900.00),
  (11208, 'AVENA DON PANCHO HOJUELAS X180 G.', 1, 2800.00)
) AS v(variant_id, name, qty, price)
WHERE o.reference_code = 'MER-04924969'
  AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id);

-- 6) Pago (contraentrega) ---------------------------------------------------
INSERT INTO payments
  (order_id, provider_transaction_id, amount, currency, payment_method,
   installments, status, paid_at, created_at)
SELECT o.id, 'test-delivery-' || o.reference_code, o.grand_total, 'COP',
       'CASH', 1, 'COMPLETED', now(), now()
FROM orders o
WHERE o.reference_code IN ('MER-04924968', 'MER-04924969')
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id);

-- 7) Asignaciones en camino -------------------------------------------------
INSERT INTO delivery_assignments
  (shipment_id, driver_id, status, assigned_at, accepted_at,
   ready_for_pickup_at, picked_up_at, in_delivery_at)
SELECT s.id, d.id, 'IN_DELIVERY'::delivery_assignment_status_enum,
       now() - interval '12 min', now() - interval '11 min',
       now() - interval '10 min', now() - interval '8 min', now() - interval '5 min'
FROM shipments s
JOIN orders o ON o.id = s.order_id
JOIN delivery_drivers d ON d.auth_user_id = (SELECT id FROM users WHERE username = 'demo2')
WHERE o.reference_code = 'MER-04924968'
  AND NOT EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.shipment_id = s.id);

INSERT INTO delivery_assignments
  (shipment_id, driver_id, status, assigned_at, accepted_at,
   ready_for_pickup_at, picked_up_at, in_delivery_at)
SELECT s.id, d.id, 'IN_DELIVERY'::delivery_assignment_status_enum,
       now() - interval '12 min', now() - interval '11 min',
       now() - interval '10 min', now() - interval '8 min', now() - interval '5 min'
FROM shipments s
JOIN orders o ON o.id = s.order_id
JOIN delivery_drivers d ON d.auth_user_id = (SELECT id FROM users WHERE username = 'demo3')
WHERE o.reference_code = 'MER-04924969'
  AND NOT EXISTS (SELECT 1 FROM delivery_assignments a WHERE a.shipment_id = s.id);

COMMIT;
