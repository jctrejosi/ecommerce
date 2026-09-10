-- ============================================================================
-- 07_test_delivery_order.sql
-- ----------------------------------------------------------------------------
-- Crea un PEDIDO DE PRUEBA con toda su cadena para probar el rastreo en vivo
-- del cliente y la asignación en la app de delivery.
--
-- Cadena que arma:
--   customers → orders → order_items → shipments → delivery_assignments
--                                   → payments → order_status_history
--                                   → delivery_events
--   delivery_drivers (ubicación actual) → delivery_driver_locations
--
-- Deja el pedido en estado "en camino":
--   orders.status       = 'shipped'      (el cliente lo ve como "en camino")
--   shipments.status    = 'IN_TRANSIT'
--   delivery_assignments.status = 'IN_DELIVERY'  (activo para el repartidor)
--
-- NOTA: `idx_driver_active_assignment` solo permite UNA asignación activa por
-- repartidor, así que antes se cierra la entrega activa que tuviera pendiente.
--
-- Uso:
--   psql "postgresql://postgres:postgres@localhost:5432/ecommerce" \
--        -f db/sql/07_test_delivery_order.sql
-- ============================================================================

DO $$
DECLARE
  -- ── Parámetros: los únicos registros existentes hoy en esta BD ────────────
  v_driver_id    bigint  := 1;  -- delivery_drivers.id  (Demo Repartidor → user 'demo')
  v_customer_id  bigint  := 1;  -- customers.id         (cliente@mercaldas.com.co)
  v_branch_id    bigint  := 1;  -- branches.id          (Mercaldas Centro)

  -- ── Puntos de interés (Manizales) ─────────────────────────────────────────
  v_dest_lng     numeric := -75.5188;   -- destino de entrega
  v_dest_lat     numeric := 5.0329;
  v_driver_lng   numeric := -75.5185;   -- repartidor "en camino"
  v_driver_lat   numeric := 5.0490;

  -- ── Totales ───────────────────────────────────────────────────────────────
  v_subtotal     numeric(12,2) := 19200.00;
  v_shipping     numeric(12,2) := 4900.00;

  -- ── Variables de trabajo ──────────────────────────────────────────────────
  v_now              timestamptz := now();
  v_code             varchar(20);
  v_order_id         bigint;
  v_shipment_id      bigint;
  v_assignment_id    bigint;

  v_prev_assignment_ids bigint[];
  v_prev_shipment_ids   bigint[];
  v_prev_order_ids      bigint[];
BEGIN
  -- ── 0. Liberar al repartidor: cerrar su entrega activa previa ─────────────
  SELECT array_agg(a.id), array_agg(a.shipment_id), array_agg(s.order_id)
    INTO v_prev_assignment_ids, v_prev_shipment_ids, v_prev_order_ids
    FROM delivery_assignments a
    JOIN shipments s ON s.id = a.shipment_id
   WHERE a.driver_id = v_driver_id
     AND a.status IN ('ASSIGNED', 'PICKED_UP', 'IN_DELIVERY');

  IF v_prev_assignment_ids IS NOT NULL THEN
    UPDATE delivery_assignments
       SET status = 'DELIVERED', completed_at = COALESCE(completed_at, v_now)
     WHERE id = ANY (v_prev_assignment_ids);

    UPDATE shipments
       SET status = 'DELIVERED', delivered_at = COALESCE(delivered_at, v_now),
           updated_at = v_now
     WHERE id = ANY (v_prev_shipment_ids);

    UPDATE orders
       SET status = 'delivered', updated_at = v_now
     WHERE id = ANY (v_prev_order_ids);
  END IF;

  -- ── 1. Código de referencia único (MER-XXXXXXXX) ──────────────────────────
  LOOP
    v_code := 'MER-' || lpad((floor(random() * 100000000))::text, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM orders WHERE reference_code = v_code);
  END LOOP;

  -- ── 2. Pedido ─────────────────────────────────────────────────────────────
  INSERT INTO orders (
    reference_code, customer_id, branch_id, status, currency_code, exchange_rate,
    subtotal, discount_total, tax_total, shipping_cost, shipping_tax, grand_total,
    customer_name, customer_phone, customer_email, notes, internal_notes,
    created_at, updated_at
  ) VALUES (
    v_code, v_customer_id, v_branch_id, 'shipped', 'COP', 1.0,
    v_subtotal, 0, 0, v_shipping, 0, v_subtotal + v_shipping,
    'Carlos Ríos', '3007654321', 'cliente@mercaldas.com.co',
    'Edificio Altos del Cable, apto 1202. Llamar al llegar.',
    'Pedido de prueba — rastreo en vivo + asignación en delivery',
    v_now, v_now
  )
  RETURNING id INTO v_order_id;

  -- ── 3. Ítems del pedido (variantes existentes) ────────────────────────────
  INSERT INTO order_items (
    order_id, product_variant_id, product_name, quantity,
    unit_price_net, unit_price_gross, subtotal, total,
    tax_rate, discount_amount, tax_amount, picked_qty, created_at
  ) VALUES
    (v_order_id, 10386, 'ARVEJAS/ZANAHORIA ZENU 355GR LA', 1, 8900, 8900, 8900, 8900, 0, 0, 0, 1, v_now),
    (v_order_id, 10388, 'ARVEJA ZENU NATURAL 355GR LA',    1, 7500, 7500, 7500, 7500, 0, 0, 0, 1, v_now),
    (v_order_id, 11208, 'AVENA DON PANCHO HOJUELAS X180 G.', 1, 2800, 2800, 2800, 2800, 0, 0, 0, 1, v_now);

  -- ── 4. Envío (destino en el mapa) ─────────────────────────────────────────
  INSERT INTO shipments (
    order_id, address_line1, address_line2, city, location, status,
    recipient_name, recipient_phone, created_at, updated_at
  ) VALUES (
    v_order_id, 'Cra 22 # 72-10', 'Apto 1202', 'Manizales',
    format('POINT(%s %s)', v_dest_lng, v_dest_lat), 'IN_TRANSIT',
    'Carlos Ríos', '3007654321', v_now, v_now
  )
  RETURNING id INTO v_shipment_id;

  -- ── 5. Asignación al repartidor (activa → aparece en la app de delivery) ──
  INSERT INTO delivery_assignments (
    shipment_id, driver_id, status,
    assigned_at, accepted_at, ready_for_pickup_at, picked_up_at, in_delivery_at
  ) VALUES (
    v_shipment_id, v_driver_id, 'IN_DELIVERY',
    v_now - interval '8 minutes',
    v_now - interval '7 minutes',
    v_now - interval '6 minutes',
    v_now - interval '5 minutes',
    v_now - interval '3 minutes'
  )
  RETURNING id INTO v_assignment_id;

  -- ── 6. Pago (contraentrega) ───────────────────────────────────────────────
  INSERT INTO payments (
    order_id, provider_transaction_id, amount, currency,
    payment_method, installments, status, paid_at, created_at
  ) VALUES (
    v_order_id, 'test-delivery-' || v_code, v_subtotal + v_shipping, 'COP',
    'CASH', 1, 'COMPLETED', v_now, v_now
  );

  -- ── 7. Historial de estados del pedido ────────────────────────────────────
  INSERT INTO order_status_history (order_id, status, note, created_at) VALUES
    (v_order_id, 'created',   'Pedido de prueba creado',           v_now - interval '10 minutes'),
    (v_order_id, 'paid',      'Pago confirmado (contraentrega)',   v_now - interval '9 minutes'),
    (v_order_id, 'preparing', 'Alistando en tienda',               v_now - interval '8 minutes'),
    (v_order_id, 'shipped',   'Repartidor en camino al cliente',   v_now - interval '3 minutes');

  -- ── 8. Eventos de la entrega ──────────────────────────────────────────────
  INSERT INTO delivery_events (assignment_id, event_type, location, description, created_at) VALUES
    (v_assignment_id, 'ASSIGNED',   NULL, 'Pedido asignado al repartidor',        v_now - interval '8 minutes'),
    (v_assignment_id, 'ARRIVED',    NULL, 'Repartidor llegó a la tienda',         v_now - interval '6 minutes'),
    (v_assignment_id, 'PICKED_UP',  NULL, 'Pedido recogido en la tienda',         v_now - interval '5 minutes'),
    (v_assignment_id, 'LOCATION_UPDATE',
      format('POINT(%s %s)', v_driver_lng, v_driver_lat),
      'Repartidor en camino al cliente', v_now - interval '3 minutes');

  -- ── 9. Ubicación actual del repartidor (la pinta el mapa del cliente) ─────
  UPDATE delivery_drivers
     SET current_location = format('POINT(%s %s)', v_driver_lng, v_driver_lat),
         last_location_at = v_now,
         is_available     = true,
         updated_at       = v_now
   WHERE id = v_driver_id;

  INSERT INTO delivery_driver_locations (driver_id, location, speed_kmh, heading_degrees, recorded_at)
  VALUES (v_driver_id, format('POINT(%s %s)', v_driver_lng, v_driver_lat), 24.5, 180, v_now);

  RAISE NOTICE 'Pedido de prueba creado: % (order_id=%, shipment_id=%, assignment_id=%)',
    v_code, v_order_id, v_shipment_id, v_assignment_id;
END $$;
