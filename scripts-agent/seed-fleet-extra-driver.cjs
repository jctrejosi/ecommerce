/**
 * Siembra un SEGUNDO repartidor con una entrega activa (para poder ver en el
 * mapa que, al seleccionar uno, la ruta de los demás se atenúa). Se borra con
 * `--clean`. Se reconoce por el nombre y por el `reference_code` (QA-FLEET-).
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-fleet-extra-driver.cjs
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-fleet-extra-driver.cjs --clean
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const PREFIX = 'QA-FLEET-';
const DRIVER_NAME = 'QA Ruta Dos';
const BRANCH_ID = 1;
const CUSTOMER_ID = 15;
/** Cerca del otro repartidor, para que ambas rutas entren en el encuadre. */
const DRIVER_LOCATION = 'POINT(-75.5000 5.0450)';
const DESTINATION = 'POINT(-75.4900 5.0350)';

async function clean(db) {
  // Primero los pedidos: al borrarlos caen sus asignaciones (cascade) y solo
  // entonces el repartidor deja de estar referenciado.
  const o = await db.query('DELETE FROM orders WHERE reference_code LIKE $1', [`${PREFIX}%`]);
  const d = await db.query('DELETE FROM delivery_drivers WHERE full_name = $1', [DRIVER_NAME]);
  console.log(`Borrados: ${o.rowCount} pedido(s), ${d.rowCount} repartidor(es)`);
}

async function seed(db) {
  const now = new Date().toISOString();

  const drv = await db.query(
    `INSERT INTO delivery_drivers (
       full_name, phone, vehicle_type, vehicle_plate,
       is_available, is_active, current_location, last_location_at, last_seen_at,
       route_color, created_at, updated_at
     ) VALUES ($1,$2,'Moto','QA-002',true,true,$3,$4,$4,'#e11d48',$4,$4)
     RETURNING id`,
    [DRIVER_NAME, '3000000000', DRIVER_LOCATION, now],
  );
  const driverId = drv.rows[0].id;

  const o = await db.query(
    `INSERT INTO orders (
       reference_code, customer_id, branch_id, status, currency_code,
       subtotal, discount_total, tax_total, shipping_cost, shipping_tax, grand_total,
       customer_name, customer_phone, notes, created_at, updated_at
     ) VALUES ($1,$2,$3,'shipped','COP',18000,0,0,7900,0,25900,'Cliente QA','3000000001',$4,$5,$5)
     RETURNING id`,
    [`${PREFIX}1`, CUSTOMER_ID, BRANCH_ID, 'Pedido temporal de verificación del mapa', now],
  );
  const orderId = o.rows[0].id;

  const s = await db.query(
    `INSERT INTO shipments (order_id, address_line1, city, location, status, created_at, updated_at)
     VALUES ($1,'Calle 50 # 20-10','Manizales',$2,'PENDING',$3,$3) RETURNING id`,
    [orderId, DESTINATION, now],
  );

  await db.query(
    `INSERT INTO delivery_assignments (shipment_id, driver_id, status, assigned_at, accepted_at)
     VALUES ($1,$2,'ACCEPTED',$3,$3)`,
    [s.rows[0].id, driverId, now],
  );

  console.log(`  ${DRIVER_NAME}  driver=${driverId}  order=${orderId} (${PREFIX}1)`);
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const who = await db.query('SELECT current_database() AS db');
    console.log(`DB: ${who.rows[0].db}`);
    await clean(db); // idempotente
    if (process.argv.includes('--clean')) return;
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
