/**
 * Inspección (solo lectura) de pedidos "en camino" (orders.status = 'shipped')
 * y de las asignaciones de delivery, para detectar pedidos sin repartidor.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/inspect-delivery-orders.cjs
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    console.log('== Pedidos con status shipped (cliente ve "en camino") ==');
    const shipped = await db.query(`
      SELECT o.id, o.reference_code, o.status, o.customer_name, o.customer_phone,
             o.grand_total, o.created_at,
             s.id AS shipment_id,
             a.id AS assignment_id, a.status AS assignment_status,
             a.driver_id, d.full_name AS driver_name
      FROM orders o
      LEFT JOIN shipments s ON s.order_id = o.id
      LEFT JOIN delivery_assignments a ON a.shipment_id = s.id
      LEFT JOIN delivery_drivers d ON d.id = a.driver_id
      WHERE o.status = 'shipped'
      ORDER BY o.id DESC
    `);
    for (const r of shipped.rows) {
      console.log(
        `#${r.id} ${r.reference_code} | cliente="${r.customer_name}" tel=${r.customer_phone} | ` +
          `shipment=${r.shipment_id ?? '-'} asignación=${r.assignment_id ?? 'NINGUNA'}/${
            r.assignment_status ?? '-'
          } | driver=${r.driver_id ?? 'NINGUNO'} ${r.driver_name ?? ''} | ${r.created_at?.toISOString?.() ?? r.created_at}`,
      );
    }
    console.log(`total shipped: ${shipped.rows.length}`);

    console.log('\n== Todas las asignaciones de delivery ==');
    const assigns = await db.query(`
      SELECT a.id, a.status, s.order_id, d.full_name AS driver_name
      FROM delivery_assignments a
      LEFT JOIN shipments s ON s.id = a.shipment_id
      LEFT JOIN delivery_drivers d ON d.id = a.driver_id
      ORDER BY a.id DESC
      LIMIT 20
    `);
    for (const r of assigns.rows) {
      console.log(
        `asignación #${r.id} status=${r.status} order=${r.order_id} driver="${r.driver_name ?? ''}"`,
      );
    }

    console.log('\n== Pedidos recientes (todos los estados) ==');
    const recent = await db.query(`
      SELECT id, reference_code, status, customer_name, created_at
      FROM orders ORDER BY id DESC LIMIT 12
    `);
    for (const r of recent.rows) {
      console.log(
        `#${r.id} ${r.reference_code} ${r.status} cliente="${r.customer_name}"`,
      );
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
