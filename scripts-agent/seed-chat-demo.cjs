/**
 * Crea el entorno demo para el chat por pedido:
 *  - Repartidores demo (demo/demo2/demo3, clave demo1234) manteniendo a Juan.
 *  - 3 pedidos "en camino" (IN_DELIVERY): 2 del cliente Carlos Ríos y 1 de
 *    demo-tienda, asignados a Juan, demo y demo2 respectivamente.
 *  - Mensajes iniciales de chat en el pedido de Juan (cliente ↔ repartidor).
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-chat-demo.cjs
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const DEMO_PASSWORD = 'demo1234';

/** Repartidores demo a crear (si no existen). */
const DEMO_DRIVERS = [
  {
    username: 'demo',
    email: 'demo@dsi.com',
    fullName: 'Demo Repartidor',
    phone: '3001112233',
    plate: 'ABC-12D',
    color: '#2563EB',
  },
  {
    username: 'demo2',
    email: 'demo2@dsi.com',
    fullName: 'Demo Repartidor 2',
    phone: '3002223344',
    plate: 'DEF-34G',
    color: '#EF4444',
  },
  {
    username: 'demo3',
    email: 'demo3@dsi.com',
    fullName: 'Demo Repartidor 3',
    phone: '3003334455',
    plate: 'HIJ-56K',
    color: '#10B981',
  },
];

/** Pedidos demo: [cliente (customers.id), repartidor (username de users), destino]. */
const ORDERS = [
  {
    customerId: 1, // Carlos Ríos (cliente@mercaldas.com.co)
    driverUsername: 'juan', // repartidor existente
    dest: { lng: -75.5188, lat: 5.0329 },
    driverPos: { lng: -75.5185, lat: 5.049 },
    clientName: 'Carlos Ríos',
    address: 'Cra 22 # 72-10, Apto 1202',
  },
  {
    customerId: 1, // Carlos Ríos — segundo pedido en camino
    driverUsername: 'demo',
    dest: { lng: -75.5111, lat: 5.0381 },
    driverPos: { lng: -75.5151, lat: 5.0511 },
    clientName: 'Carlos Ríos',
    address: 'Cra 22 # 72-10, Apto 1202',
  },
  {
    customerId: 7, // Demo Tienda (demo-tienda@mercaldas.co)
    driverUsername: 'demo2',
    dest: { lng: -75.5051, lat: 5.0611 },
    driverPos: { lng: -75.5101, lat: 5.0681 },
    clientName: 'Demo Tienda',
    address: 'Calle 55 # 20-30, Apto 501',
  },
];

const pad = (n) => String(n).padStart(8, '0');

async function ensureUser(db, d) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const found = await db.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [
    d.username,
  ]);
  if (found.rowCount > 0) {
    await db.query(
      `UPDATE users SET email = $2, password_hash = $3, is_active = true,
         deleted_at = NULL, locked_until = NULL, filed_attempts = 0,
         is_superuser = false, is_picker = false, updated_at = now()
       WHERE username = $1`,
      [d.username, d.email, hash],
    );
    return found.rows[0].id;
  }
  const inserted = await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_picker)
     VALUES ($1, $2, $3, $4, $5, false, false) RETURNING id`,
    [d.email, d.username, hash, d.fullName.split(' ')[0], d.fullName.split(' ').slice(1).join(' ')],
  );
  return inserted.rows[0].id;
}

async function ensureDriver(db, d, userId) {
  const found = await db.query(
    'SELECT id FROM delivery_drivers WHERE auth_user_id = $1 LIMIT 1',
    [userId],
  );
  if (found.rowCount > 0) {
    await db.query(
      `UPDATE delivery_drivers SET full_name = $2, phone = $3, email = $4,
         vehicle_type = 'Motocicleta', vehicle_plate = $5,
         is_active = true, is_available = true, route_color = $6,
         deleted_at = NULL, updated_at = now()
       WHERE auth_user_id = $1`,
      [userId, d.fullName, d.phone, d.email, d.plate, d.color],
    );
    return found.rows[0].id;
  }
  const inserted = await db.query(
    `INSERT INTO delivery_drivers (full_name, phone, email, vehicle_type, vehicle_plate, is_available, is_active, auth_user_id, route_color)
     VALUES ($1, $2, $3, 'Motocicleta', $4, true, true, $5, $6) RETURNING id`,
    [d.fullName, d.phone, d.email, d.plate, userId, d.color],
  );
  return inserted.rows[0].id;
}

async function nextCode(db) {
  for (;;) {
    const code = 'MER-' + pad(Math.floor(Math.random() * 100000000));
    const found = await db.query(
      'SELECT 1 FROM orders WHERE reference_code = $1 LIMIT 1',
      [code],
    );
    if (found.rowCount === 0) return code;
  }
}

async function createOrder(db, spec, driver) {
  const now = new Date();
  const code = await nextCode(db);

  const order = await db.query(
    `INSERT INTO orders (
       reference_code, customer_id, branch_id, status, currency_code, exchange_rate,
       subtotal, discount_total, tax_total, shipping_cost, shipping_tax, grand_total,
       customer_name, customer_phone, customer_email, notes, created_at, updated_at
     ) VALUES ($1, $2, 1, 'shipped', 'COP', 1.0, 19200, 0, 0, 4900, 0, 24100,
       $3, '3007654321', $4, 'Pedido demo — chat por pedido', now(), now())
     RETURNING id`,
    [code, spec.customerId, spec.clientName, spec.clientName === 'Demo Tienda' ? 'demo-tienda@mercaldas.co' : 'cliente@mercaldas.com.co'],
  );
  const orderId = order.rows[0].id;

  // Ítems (usa variantes existentes del catálogo).
  const variants = await db.query(
    `SELECT pv.id, p.name FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     ORDER BY pv.id LIMIT 3`,
  );
  for (let i = 0; i < variants.rows.length; i++) {
    const v = variants.rows[i];
    const price = 6400 - i * 1500;
    await db.query(
      `INSERT INTO order_items (order_id, product_variant_id, product_name, quantity,
         unit_price_net, unit_price_gross, subtotal, total, picked_qty, created_at)
       VALUES ($1, $2, $3, 1, $4, $4, $4, $4, 1, now())`,
      [orderId, v.id, v.name, price],
    );
  }

  const shipment = await db.query(
    `INSERT INTO shipments (order_id, address_line1, city, location, status,
        recipient_name, recipient_phone, created_at, updated_at)
     VALUES ($1, $2, 'Manizales', $3, 'IN_TRANSIT', $4, '3007654321', now(), now())
     RETURNING id`,
    [orderId, spec.address, `POINT(${spec.dest.lng} ${spec.dest.lat})`, spec.clientName],
  );
  const shipmentId = shipment.rows[0].id;

  await db.query(
    `INSERT INTO delivery_assignments (shipment_id, driver_id, status,
        assigned_at, accepted_at, ready_for_pickup_at, picked_up_at, in_delivery_at)
     VALUES ($1, $2, 'IN_DELIVERY',
        now() - interval '8 minutes', now() - interval '7 minutes',
        now() - interval '6 minutes', now() - interval '5 minutes',
        now() - interval '3 minutes')`,
    [shipmentId, driver.driverId],
  );

  await db.query(
    `INSERT INTO payments (order_id, provider_transaction_id, amount, currency,
        payment_method, installments, status, paid_at, created_at)
     VALUES ($1, $2, 24100, 'COP', 'CASH', 1, 'COMPLETED', now(), now())`,
    [orderId, 'test-chat-' + code],
  );

  await db.query(
    `INSERT INTO order_status_history (order_id, status, note, created_at) VALUES
       ($1, 'created',   'Pedido demo creado',               now() - interval '10 minutes'),
       ($1, 'paid',      'Pago confirmado (contraentrega)',  now() - interval '9 minutes'),
       ($1, 'preparing', 'Alistando en tienda',              now() - interval '8 minutes'),
       ($1, 'shipped',   'Repartidor en camino al cliente',  now() - interval '3 minutes')`,
    [orderId],
  );

  // Posición actual del repartidor (la pinta el mapa del cliente).
  await db.query(
    `UPDATE delivery_drivers SET current_location = $2, last_location_at = now(),
        is_available = true, updated_at = now() WHERE id = $1`,
    [driver.driverId, `POINT(${spec.driverPos.lng} ${spec.driverPos.lat})`],
  );

  return { code, orderId };
}

async function seedChat(db, orderId, driverUserId) {
  const msgs = [
    {
      senderType: 'customer',
      senderUserId: null,
      body: 'Hola, ¿cómo va la entrega? Estoy pendiente 😊',
      at: "now() - interval '25 minutes'",
    },
    {
      senderType: 'delivery',
      senderUserId: driverUserId,
      body: '¡Hola Carlos! Ya recogí tu pedido y voy en camino 🛵',
      at: "now() - interval '22 minutes'",
    },
    {
      senderType: 'customer',
      senderUserId: null,
      body: '¡Perfecto! Estoy en el apartamento 1202, llamas al llegar por favor.',
      at: "now() - interval '20 minutes'",
    },
    {
      senderType: 'delivery',
      senderUserId: driverUserId,
      body: 'Dale, llego en unos 10 minutos 👍',
      at: "now() - interval '18 minutes'",
    },
  ];
  for (const m of msgs) {
    await db.query(
      `INSERT INTO order_chat_messages (order_id, sender_type, sender_user_id, body, created_at)
       VALUES ($1, $2, $3, $4, ${m.at})`,
      [orderId, m.senderType, m.senderUserId, m.body],
    );
  }
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    // 1. Repartidores demo.
    const demoDrivers = {};
    for (const d of DEMO_DRIVERS) {
      const userId = await ensureUser(db, d);
      const driverId = await ensureDriver(db, d, userId);
      demoDrivers[d.username] = { driverId, userId };
      console.log(`Repartidor listo: ${d.username} / ${DEMO_PASSWORD} (driver_id=${driverId})`);
    }

    // 2. Juan (repartidor existente).
    const juan = await db.query(
      `SELECT d.id AS driver_id, d.auth_user_id AS user_id
       FROM delivery_drivers d WHERE d.auth_user_id = 19 LIMIT 1`,
    );
    if (juan.rowCount === 0) throw new Error('No existe el repartidor Juan (users.id=19).');
    const juanDriver = { driverId: juan.rows[0].driver_id, userId: juan.rows[0].user_id };

    const lookup = { juan: juanDriver, ...demoDrivers };

    // 3. Pedidos en camino.
    for (const spec of ORDERS) {
      const created = await createOrder(db, spec, lookup[spec.driverUsername]);
      console.log(
        `Pedido ${created.code} → ${spec.clientName} | repartidor ${spec.driverUsername} (order_id=${created.orderId})`,
      );
      if (spec.driverUsername === 'juan') {
        await seedChat(db, created.orderId, lookup.juan.userId);
        console.log(`  ↳ chat sembrado con 4 mensajes`);
      }
    }

    console.log('\nCredenciales:');
    console.log('  - Repartidores: demo / demo2 / demo3 → clave demo1234');
    console.log('  - Juan: usa su clave actual (usuarios.id=19).');
    console.log('  - Cliente tienda: cliente@mercaldas.com.co (Carlos Ríos) o demo-tienda@mercaldas.co / demo123.');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
