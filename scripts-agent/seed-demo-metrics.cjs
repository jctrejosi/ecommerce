/**
 * Siembra datos DEMO para que los dashboards tengan métricas:
 *   - clientes (customers)
 *   - pedidos (orders) en distintos estados, repartidos en los últimos 60 días
 *   - items (order_items), pagos (payments), historial (order_status_history)
 *   - envíos + asignaciones a repartidores (shipments/delivery_assignments/events)
 *   - pickers (users con isPicker) y repartidores (delivery_drivers)
 *
 * Todo lo sembrado se reconoce por: reference_code LIKE 'DEMO-%' (pedidos),
 * email LIKE '%@demo.local' (clientes/pickers/repartidores).
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-demo-metrics.cjs
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-demo-metrics.cjs --clean
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const PREFIX = 'DEMO-';
const DOMAIN = '@demo.local';
const N_CUSTOMERS = Number(process.env.N_CUSTOMERS || 40);
const PICKERS = [
  ['Andrés', 'Gómez'], ['Carolina', 'Ruiz'], ['Julián', 'Mejía'], ['Paula', 'Cárdenas'],
];
const DRIVERS = [
  ['Diego', 'Ramírez', 'Moto', 'DEM-01'],
  ['Sofía', 'Herrera', 'Moto', 'DEM-02'],
  ['Mateo', 'Vargas', 'Bicicleta', 'DEM-03'],
  ['Valentina', 'Ospina', 'Moto', 'DEM-04'],
  ['Santiago', 'Castaño', 'Carro', 'DEM-05'],
  ['Isabella', 'Sánchez', 'Moto', 'DEM-06'],
];
const FIRST = ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Laura', 'Jorge', 'Camila',
  'Andrés', 'Daniela', 'Felipe', 'Sara', 'Sebastián', 'Natalia', 'David', 'Valeria'];
const LAST = ['Pérez', 'Gómez', 'Rodríguez', 'Martínez', 'López', 'García', 'Hernández',
  'Torres', 'Ramírez', 'Vargas', 'Castaño', 'Ospina'];

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const money = (n) => n.toFixed(2);
const daysAgo = (d, hh = 12, mm = 0) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(hh, mm, 0, 0);
  return t.toISOString();
};
// Día del pedido, sesgado a los últimos días para que los KPIs "de hoy/últimos días"
// de los dashboards tengan volumen (30% hoy, 15% ayer, ...).
const randomDay = () => {
  const r = Math.random();
  if (r < 0.3) return 0;
  if (r < 0.45) return 1;
  if (r < 0.55) return 2;
  if (r < 0.63) return 3;
  if (r < 0.7) return 4;
  return rint(5, 60);
};
// Fecha de creación nunca en el futuro; para hoy, reparte las horas hasta "ahora".
const randomCreatedAt = (day) => {
  const now = new Date();
  if (day === 0) {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mins = Math.max(1, Math.floor((now.getTime() - midnight.getTime()) / 60000) - 1);
    return new Date(midnight.getTime() + rint(0, mins) * 60000).toISOString();
  }
  return daysAgo(day, rint(8, 20), rint(0, 59));
};
const addH = (iso, h) => new Date(new Date(iso).getTime() + h * 3600 * 1000).toISOString();

// Distribución de estados finales (para que las métricas se vean variadas)
const STATUS_POOL = [
  ...Array(40).fill('delivered'),
  ...Array(15).fill('shipped'),
  ...Array(8).fill('preparing'),
  ...Array(7).fill('ready'),
  ...Array(10).fill('paid'),
  ...Array(8).fill('payment_pending'),
  ...Array(5).fill('created'),
  ...Array(5).fill('cancelled'),
  ...Array(2).fill('refunded'),
];
const PROGRESSION = ['created', 'payment_pending', 'paid', 'preparing', 'ready', 'shipped', 'delivered'];

async function clean(db) {
  const { rows } = await db.query(`SELECT id FROM orders WHERE reference_code LIKE $1`, [`${PREFIX}%`]);
  const ids = rows.map((r) => Number(r.id));
  if (ids.length) {
    await db.query(`DELETE FROM payments WHERE order_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM order_status_history WHERE order_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM order_items WHERE order_id = ANY($1)`, [ids]);
    await db.query(
      `DELETE FROM delivery_assignments WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id = ANY($1))`,
      [ids],
    );
    await db.query(`DELETE FROM shipments WHERE order_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM orders WHERE id = ANY($1)`, [ids]);
  }
  await db.query(`DELETE FROM delivery_drivers WHERE email LIKE $1`, [`%${DOMAIN}`]);
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`%${DOMAIN}`]);
  await db.query(`DELETE FROM customers WHERE email LIKE $1`, [`%${DOMAIN}`]);
  console.log(`🧹 Limpieza: ${ids.length} pedidos demo eliminados (y sus clientes/pickers/repartidores).`);
}

async function seed(db) {
  // Sucursales (las 3 de TID; si no, cualquiera activa)
  let branches = (
    await db.query(`SELECT id FROM branches WHERE code IN ('1','2','11') ORDER BY id`)
  ).rows.map((r) => Number(r.id));
  if (!branches.length) {
    branches = (
      await db.query(`SELECT id FROM branches WHERE is_active = true ORDER BY id LIMIT 3`)
    ).rows.map((r) => Number(r.id));
  }
  console.log(`Sucursales: ${branches.join(', ')}`);

  // Pool de variantes (prefiriendo productos con imagen)
  const variants = (
    await db.query(
      `SELECT v.id, p.name, v.current_price
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN product_images pi ON pi.product_id = p.id AND pi.is_cover = true
        WHERE p.is_active AND v.is_active AND v.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY p.id LIMIT 500`,
    )
  ).rows;
  if (!variants.length) throw new Error('No hay variantes con imagen para sembrar pedidos.');
  console.log(`Variantes disponibles: ${variants.length}`);

  // ── Clientes ──
  const customerIds = [];
  for (let i = 0; i < N_CUSTOMERS; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const email = `${first}.${last}${i}${DOMAIN}`.toLowerCase();
    const { rows } = await db.query(
      `INSERT INTO customers
         (email, first_name, last_name, phone, document_type, document_number,
          customer_type, is_active, provider, is_verified, email_verified,
          accepts_marketing, birth_date, gender, last_activity_at)
       VALUES ($1,$2,$3,$4,'CC',$5,'registered',true,'local',true,true,$6,$7,$8,now())
       RETURNING id`,
      [
        email, first, last, `3${rint(100000000, 299999999)}`,
        String(rint(10000000, 1099999999)),
        Math.random() > 0.5,
        `19${rint(70, 99)}-0${rint(1, 9)}-${rint(10, 28)}`,
        pick(['F', 'M', 'Otro']),
      ],
    );
    customerIds.push(Number(rows[0].id));
  }
  console.log(`👤 Clientes: ${customerIds.length}`);

  // ── Pickers (users) ──
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('Demo1234', 10);
  const pickerIds = [];
  for (let i = 0; i < PICKERS.length; i++) {
    const [first, last] = PICKERS[i];
    const { rows } = await db.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name,
                          phone, is_superuser, is_active, is_picker)
       VALUES ($1,$2,$3,$4,$5,$6,false,true,true) RETURNING id`,
      [`picker${i + 1}${DOMAIN}`, `demo_picker${i + 1}`, hash, first, last, `3${rint(100000000, 299999999)}`],
    );
    const uid = Number(rows[0].id);
    pickerIds.push(uid);
    await db.query(`INSERT INTO user_branches (user_id, branch_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
      uid,
      branches[i % branches.length],
    ]);
  }
  console.log(`🧑🌾 Pickers: ${pickerIds.length} (password Demo1234)`);

  // ── Repartidores ──
  const driverIds = [];
  for (const [first, last, vehicle, plate] of DRIVERS) {
    const { rows } = await db.query(
      `INSERT INTO delivery_drivers
         (full_name, phone, email, vehicle_type, vehicle_plate, is_available, is_active,
          current_location, last_location_at, last_seen_at, route_color)
       VALUES ($1,$2,$3,$4,$5,true,true,'POINT(-75.5188 5.0329)',now(),now(),$6) RETURNING id`,
      [`${first} ${last}`, `3${rint(100000000, 299999999)}`, `driver_${plate}${DOMAIN}`.toLowerCase(),
       vehicle, plate, pick(['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'])],
    );
    driverIds.push(Number(rows[0].id));
  }
  console.log(`🛵 Repartidores: ${driverIds.length}`);

  // ── Pedidos ──
  const created = [];
  // Repartidores con entrega activa: idx_driver_active_delivery permite sólo una
  // asignación PICKED_UP/IN_DELIVERY por repartidor.
  const activeDrivers = new Set();
  let seq = 0;
  for (const customerId of customerIds) {
    const nOrders = rint(2, 6);
    for (let o = 0; o < nOrders; o++) {
      const branchId = pick(branches);
      const day = randomDay();
      const createdFinal = randomCreatedAt(day);
      // En la ventana reciente, refuerza el estado 'paid': la gráfica de ingresos
      // por día del dashboard sólo suma status='paid', así que sin esto quedaría
      // vacía en días que no tuvieran ese estado por azar.
      const status = day <= 6 && Math.random() < 0.45 ? 'paid' : pick(STATUS_POOL);

      // Items
      const nItems = rint(1, 4);
      const items = [];
      for (let k = 0; k < nItems; k++) {
        const v = pick(variants);
        const qty = rint(1, 3);
        const gross = Number(v.current_price) || 3000;
        const net = Math.round((gross / 1.19) * 100) / 100;
        const tax = Math.round((gross - net) * 100) / 100;
        items.push({ variantId: Number(v.id), name: v.name, qty, gross, net, tax });
      }
      const subtotal = items.reduce((s, it) => s + it.net * it.qty, 0);
      const taxTotal = items.reduce((s, it) => s + it.tax * it.qty, 0);
      const shipping = day % 3 === 0 ? 0 : pick([4900, 7900, 9900]);
      const grandTotal = subtotal + taxTotal + shipping;

      const refCode = `${PREFIX}${String(++seq).padStart(6, '0')}`;
      const progressIdx = STATUS_POOL.includes(status) && PROGRESSION.includes(status)
        ? PROGRESSION.indexOf(status)
        : PROGRESSION.indexOf('paid');

      const pickerId = PROGRESSION.indexOf(status) >= 3 ? pick(pickerIds) : null;
      const pickedAt = pickerId ? addH(createdFinal, 1 + Math.random() * 2) : null;
      const completedAt = pickerId ? addH(pickedAt, 1 + Math.random() * 3) : null;

      const ord = await db.query(
        `INSERT INTO orders (
           reference_code, customer_id, branch_id, status, currency_code,
           subtotal, discount_total, tax_total, shipping_cost, shipping_tax, grand_total,
           customer_name, customer_phone, customer_email, notes,
           picker_id, picked_at, completed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'COP',$5,0,$6,$7,0,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          refCode, customerId, branchId, status,
          money(subtotal), money(taxTotal), money(shipping), money(grandTotal),
          'Cliente Demo', `3${rint(100000000, 299999999)}`, `cliente${customerId}${DOMAIN}`,
          `Pedido demo (${status})`, pickerId, pickedAt, completedAt, createdFinal,
          completedAt || createdFinal,
        ],
      );
      const orderId = Number(ord.rows[0].id);
      created.push({ orderId, refCode, status, createdFinal, branchId, grandTotal });

      // Items
      for (const it of items) {
        await db.query(
          `INSERT INTO order_items
             (order_id, product_variant_id, product_name, variant_sku, quantity, picked_qty,
              unit_price_net, unit_price_gross, discount_amount, tax_amount, subtotal, tax_rate, total, created_at)
           VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,0,$8,$9,19,$10,$11)`,
          [
            orderId, it.variantId, it.name.slice(0, 255), it.qty,
            pickerId ? it.qty : 0, money(it.net), money(it.gross), money(it.tax * it.qty),
            money(it.net * it.qty), money(it.gross * it.qty), createdFinal,
          ],
        );
      }

      // Historial
      const chain = ['cancelled', 'refunded'].includes(status)
        ? [...PROGRESSION.slice(0, 3), status]
        : PROGRESSION.slice(0, progressIdx + 1);
      let t = createdFinal;
      let prev = null;
      for (const st of chain) {
        await db.query(
          `INSERT INTO order_status_history (order_id, status, old_status, note, created_by, picker_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [orderId, st, prev, `Demo → ${st}`, null, PROGRESSION.indexOf(st) >= 3 ? pickerId : null, t],
        );
        prev = st;
        t = addH(t, 0.5 + Math.random() * 2);
      }

      // Pago
      const payMap = {
        payment_pending: 'PENDING', paid: 'COMPLETED', preparing: 'COMPLETED', ready: 'COMPLETED',
        shipped: 'COMPLETED', delivered: 'COMPLETED', refunded: 'REFUNDED', cancelled: 'CANCELLED',
      };
      if (payMap[status]) {
        await db.query(
          `INSERT INTO payments
             (order_id, provider_transaction_id, provider_name, amount, currency, payment_method, status, paid_at, created_at)
           VALUES ($1,$2,'demo', $3,'COP',$4,$5,$6,$7)`,
          [
            orderId, `demo_${refCode}_${Math.random().toString(36).slice(2, 8)}`,
            money(grandTotal), pick(['CARD', 'PSE', 'NEQUI', 'DAVIPLATA', 'CASH']),
            payMap[status], createdFinal, createdFinal,
          ],
        );
      }

      // Envío + asignación
      if (['shipped', 'delivered'].includes(status)) {
        const deliveredIso = status === 'delivered' ? addH(completedAt || createdFinal, rint(2, 20)) : null;
        const ship = await db.query(
          `INSERT INTO shipments
             (order_id, address_line1, city, location, status, delivered_at, recipient_name, created_at, updated_at)
           VALUES ($1,$2,'Manizales','POINT(-75.5188 5.0329)',$3,$4,'Cliente Demo',$5,$6) RETURNING id`,
          [orderId, `Cra ${rint(1, 80)} # ${rint(1, 90)}-${rint(1, 40)}`, status === 'delivered' ? 'DELIVERED' : 'SHIPPED',
           deliveredIso, createdFinal, deliveredIso || createdFinal],
        );
        const shipId = Number(ship.rows[0].id);
        let driverId;
        let asgStatus;
        if (status === 'delivered') {
          driverId = pick(driverIds);
          asgStatus = 'DELIVERED';
        } else {
          const free = driverIds.filter((d) => !activeDrivers.has(d));
          if (free.length) {
            driverId = free[0];
            activeDrivers.add(driverId);
            asgStatus = 'IN_DELIVERY';
          } else {
            driverId = pick(driverIds);
            asgStatus = 'READY_FOR_PICKUP';
          }
        }
        const assignedAt = completedAt || addH(createdFinal, 4);
        const asg = await db.query(
          `INSERT INTO delivery_assignments
             (shipment_id, driver_id, status, assigned_at, accepted_at, ready_for_pickup_at,
              picked_up_at, in_delivery_at, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            shipId, driverId, asgStatus,
            assignedAt, addH(assignedAt, 0.3), addH(assignedAt, 0.8),
            addH(assignedAt, 1), addH(assignedAt, 1.2), deliveredIso,
          ],
        );
        const asgId = Number(asg.rows[0].id);
        // Nota: el enum delivery_event_type_enum NO incluye IN_DELIVERY; el
        // equivalente de progreso es ARRIVED.
        const evs = status === 'delivered'
          ? ['ASSIGNED', 'PICKED_UP', 'ARRIVED', 'DELIVERED']
          : asgStatus === 'IN_DELIVERY'
            ? ['ASSIGNED', 'PICKED_UP', 'ARRIVED']
            : ['ASSIGNED'];
        for (const ev of evs) {
          await db.query(
            `INSERT INTO delivery_events (assignment_id, event_type, description, created_at)
             VALUES ($1,$2,$3,$4)`,
            [asgId, ev, `Demo ${ev}`, addH(assignedAt, Math.random() * 4)],
          );
        }
      }
    }
  }

  console.log(`📦 Pedidos: ${created.length}`);
  const byStatus = created.reduce((m, o) => ((m[o.status] = (m[o.status] || 0) + 1), m), {});
  console.log('   por estado:', byStatus);
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const who = await db.query('SELECT current_database() AS db');
    console.log(`DB: ${who.rows[0].db}`);
    await clean(db);
    if (!process.argv.includes('--clean')) {
      await seed(db);
    }
    console.log('Listo.');
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
