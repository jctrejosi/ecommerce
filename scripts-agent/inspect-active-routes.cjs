/**
 * Revisa las asignaciones activas y, para cada una, si la ruta se calcula
 * (contexto: "hay un pedido aceptado, ¿la ruta ya se calculó?").
 * Solo imprime un resumen corto.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', {
  paths: [path.join(ROOT, 'backend/node_modules')],
}));

const DB =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

(async () => {
  const db = new Client(DB);
  await db.connect();

  const rows = await db.query(
    `SELECT a.id AS assignment_id, a.status::text AS status, a.driver_id,
            d.full_name AS driver, d.current_location, d.last_location_at, d.last_seen_at,
            s.order_id, o.reference_code,
            s.location AS destination, s.address_line1,
            b.location AS branch_location, b.name AS branch_name
       FROM delivery_assignments a
       JOIN delivery_drivers d ON d.id = a.driver_id
       JOIN shipments s ON s.id = a.shipment_id
       JOIN orders o ON o.id = s.order_id
       LEFT JOIN branches b ON b.id = o.branch_id
      WHERE a.status::text IN ('ASSIGNED','ACCEPTED','READY_FOR_PICKUP','PICKED_UP','IN_DELIVERY')
      ORDER BY a.id DESC`,
  );

  console.log(`\nAsignaciones activas: ${rows.rows.length}`);
  for (const r of rows.rows) {
    console.log(
      `  a#${r.assignment_id} ${r.status.padEnd(16)} order#${r.order_id} ${r.reference_code} ` +
        `driver=${r.driver}#${r.driver_id}`,
    );
    console.log(
      `     driver loc=${r.current_location ?? 'NULL'} lastLoc=${r.last_location_at ?? 'NULL'} lastSeen=${r.last_seen_at ?? 'NULL'}`,
    );
    console.log(
      `     destino=${r.destination ?? 'NULL'} | tienda(${r.branch_name})=${r.branch_location ?? 'NULL'}`,
    );
  }

  await db.end();
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
