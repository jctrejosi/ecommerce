/**
 * Siembra pedidos TEMPORALES (4, en estados distintos) para poder verificar a
 * ojo la columna "Tiempos" del panel de delivery admin, y los borra con
 * `--clean`. Los pedidos se reconocen por su `reference_code` (prefijo QA-TIME-).
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-orders-timeline.cjs
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-orders-timeline.cjs --clean
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const PREFIX = 'QA-TIME-';
const BRANCH_ID = 1;
const CUSTOMER_ID = 15;
const DRIVER_ID = 6;

/** Horas de hoy en que "ocurrió" cada paso (para que se lean como una secuencia). */
const h = (hh, mm) => {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

// Un pedido por estado activo, con los pasos ya cumplidos rellenos.
const CASOS = [
  {
    n: 1,
    status: 'ASSIGNED',
    orderStatus: 'shipped',
    assignedAt: h(9, 5),
  },
  {
    n: 2,
    status: 'READY_FOR_PICKUP',
    orderStatus: 'shipped',
    assignedAt: h(9, 12),
    acceptedAt: h(9, 16),
    readyForPickupAt: h(9, 28),
  },
  {
    n: 3,
    status: 'ACCEPTED',
    orderStatus: 'shipped',
    assignedAt: h(10, 2),
    acceptedAt: h(10, 7),
  },
  {
    n: 4,
    status: 'IN_DELIVERY',
    orderStatus: 'shipped',
    assignedAt: h(10, 20),
    acceptedAt: h(10, 24),
    readyForPickupAt: h(10, 33),
    pickedUpAt: h(10, 38),
    inDeliveryAt: h(10, 39),
  },
];

async function clean(db) {
  const r = await db.query('DELETE FROM orders WHERE reference_code LIKE $1', [`${PREFIX}%`]);
  console.log(`Pedidos temporales borrados: ${r.rowCount}`);
}

async function seed(db) {
  for (const c of CASOS) {
    const o = await db.query(
      `INSERT INTO orders (
         reference_code, customer_id, branch_id, status, currency_code,
         subtotal, discount_total, tax_total, shipping_cost, shipping_tax, grand_total,
         customer_name, customer_phone, notes, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,'COP',25000,0,0,9900,0,34900,$5,$6,$7,$8,$8)
       RETURNING id`,
      [
        `${PREFIX}${c.n}`,
        CUSTOMER_ID,
        BRANCH_ID,
        c.orderStatus,
        'Juan K Trejos',
        '3148854358',
        'Pedido temporal de verificación (borrar con seed-orders-timeline.cjs --clean)',
        c.assignedAt,
      ],
    );
    const orderId = o.rows[0].id;

    const s = await db.query(
      `INSERT INTO shipments (order_id, address_line1, city, location, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'PENDING',$5,$5) RETURNING id`,
      [orderId, 'Cra 22 # 72-10, Apto 1202', 'Manizales', 'POINT(-75.5188 5.0329)', c.assignedAt],
    );

    await db.query(
      `INSERT INTO delivery_assignments (
         shipment_id, driver_id, status,
         assigned_at, accepted_at, ready_for_pickup_at, picked_up_at, in_delivery_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        s.rows[0].id,
        DRIVER_ID,
        c.status,
        c.assignedAt,
        c.acceptedAt ?? null,
        c.readyForPickupAt ?? null,
        c.pickedUpAt ?? null,
        c.inDeliveryAt ?? null,
      ],
    );
    console.log(`  ${PREFIX}${c.n}  order=${orderId}  estado=${c.status}`);
  }
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const who = await db.query('SELECT current_database() AS db');
    console.log(`DB: ${who.rows[0].db}`);
    if (process.argv.includes('--clean')) {
      await clean(db);
      return;
    }
    await clean(db); // idempotente: no acumula duplicados al re-ejecutar
    await seed(db);
    console.log('Listo.');
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
