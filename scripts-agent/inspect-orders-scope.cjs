/**
 * Inspección (SOLO LECTURA) del alcance de "pedidos" en la base LOCAL.
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/inspect-orders-scope.cjs
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

// Tablas semilla + todas las hijas detectadas por FK
const TABLES = [
  'order_items',
  'order_status_history',
  'order_chat_messages',
  'payment_intents',
  'payments',
  'refunds',
  'invoices',
  'coupon_redemptions',
  'delivery_proof_media',
  'delivery_events',
  'delivery_assignments',
  'shipments',
  'orders',
];

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const host = await db.query('SELECT current_database() AS db');
    console.log('== Conexión ==', JSON.stringify(host.rows[0]));

    console.log('\n== Conteo de TODAS las tablas implicadas ==');
    let missing = [];
    for (const t of TABLES) {
      const exists = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [t],
      );
      if (exists.rowCount === 0) {
        missing.push(t);
        console.log(`  ${t.padEnd(26)} (no existe)`);
        continue;
      }
      const c = await db.query(`SELECT count(*)::int AS n FROM "${t}"`);
      console.log(`  ${t.padEnd(26)} ${String(c.rows[0].n).padStart(8)} filas`);
    }
    if (missing.length) console.log('  -> no existen:', missing.join(', '));

    console.log('\n== orders por status ==');
    const st = await db.query(
      `SELECT status::text AS status, count(*)::int AS n,
              count(DISTINCT customer_id)::int AS clientes
       FROM orders GROUP BY 1 ORDER BY 2 DESC`,
    );
    for (const r of st.rows)
      console.log(`  ${String(r.status).padEnd(14)} ${String(r.n).padStart(6)}  (${r.clientes} clientes)`);

    const cust = await db.query(
      `SELECT (SELECT count(*)::int FROM customers) AS total_clientes,
              (SELECT count(DISTINCT customer_id)::int FROM orders) AS clientes_con_pedidos`);
    console.log('\n== clientes ==', JSON.stringify(cust.rows[0]));

    const inv = await db.query(`SELECT count(*)::int AS n FROM invoices`);
    const pay = await db.query(`SELECT count(*)::int AS n FROM payments`);
    const ref = await db.query(`SELECT count(*)::int AS n FROM refunds`);
    console.log(
      `\n== RESTRICT blockers -> invoices:${inv.rows[0].n} payments:${pay.rows[0].n} refunds:${ref.rows[0].n}`,
    );
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
