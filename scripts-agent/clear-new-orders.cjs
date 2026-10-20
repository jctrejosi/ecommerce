/**
 * Limpia los pedidos "nuevos" (los que se ven en la pestaña Nuevos):
 * estados created / payment_pending / paid.
 *
 * - Hace respaldo JSON de lo que borra.
 * - Borra en orden hijo -> padre dentro de una transacción.
 * - Guarda anti-producción (se niega si la URL parece Supabase).
 *
 * Uso:
 *   NODE_PATH=backend/node_modules node scripts-agent/clear-new-orders.cjs            # dry-run
 *   NODE_PATH=backend/node_modules node scripts-agent/clear-new-orders.cjs --apply
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const fs = require('fs');
const path = require('path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const APPLY = process.argv.includes('--apply');
// Estados que el cliente mapea a la pestaña "Nuevos".
const NEW_STATUSES = ['created', 'payment_pending', 'paid'];

// Hijos primero (FK). Las tablas de delivery cuelgan de shipments/assignments.
const DELIVERY_DELETE = [
  {
    t: 'delivery_events',
    sql: `DELETE FROM delivery_events WHERE assignment_id IN (
      SELECT id FROM delivery_assignments WHERE shipment_id IN (
        SELECT id FROM shipments WHERE order_id = ANY($1::int[])))`,
  },
  {
    t: 'delivery_proof_media',
    sql: `DELETE FROM delivery_proof_media WHERE assignment_id IN (
      SELECT id FROM delivery_assignments WHERE shipment_id IN (
        SELECT id FROM shipments WHERE order_id = ANY($1::int[])))`,
  },
  {
    t: 'delivery_assignments',
    sql: `DELETE FROM delivery_assignments WHERE shipment_id IN (
      SELECT id FROM shipments WHERE order_id = ANY($1::int[]))`,
  },
];
const ORDER_ID_TABLES = [
  'refunds', 'payments', 'payment_intents', 'invoices', 'coupon_redemptions',
  'order_chat_messages', 'order_status_history', 'order_items', 'shipments',
];

function guard(url) {
  const lower = url.toLowerCase();
  if (lower.includes('supabase') || lower.includes('pooler')) {
    throw new Error('La URL apunta a PRODUCCIÓN (Supabase). Abortado.');
  }
}

async function main() {
  guard(DATABASE_URL);
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const tableExists = async (t) =>
    (await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [t],
    )).rowCount === 1;
  try {
    const orders = await db.query(
      `SELECT id, reference_code, status FROM orders WHERE status = ANY($1) ORDER BY id`,
      [NEW_STATUSES],
    );
    const ids = orders.rows.map((r) => Number(r.id));
    const byStatus = {};
    for (const r of orders.rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    console.log(`Pedidos "nuevos" (${NEW_STATUSES.join(', ')}): ${ids.length}`);
    console.log('  por estado:', JSON.stringify(byStatus));
    if (ids.length === 0) {
      console.log('\nNada que limpiar.');
      return;
    }

    const childCounts = {};
    for (const { t, sql } of DELIVERY_DELETE) {
      if (!(await tableExists(t))) continue;
      const countSql = sql.replace(/^DELETE FROM \S+/, `SELECT count(*)::int AS n FROM ${t}`);
      childCounts[t] = (await db.query(countSql, [ids])).rows[0].n;
    }
    for (const t of ORDER_ID_TABLES) {
      if (!(await tableExists(t))) continue;
      childCounts[t] = (
        await db.query(`SELECT count(*)::int AS n FROM "${t}" WHERE order_id = ANY($1::int[])`, [ids])
      ).rows[0].n;
    }
    console.log('\nHijos a borrar:', JSON.stringify(childCounts));

    if (!APPLY) {
      console.log('\nDRY-RUN: nada borrado. Ejecuta con --apply para limpiar.');
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join('db', 'backups', 'new-orders-cleanup', stamp);
    const backup = { orders: orders.rows };
    for (const { t, sql } of DELIVERY_DELETE) {
      if (!(await tableExists(t))) continue;
      backup[t] = (await db.query(sql.replace(/^DELETE FROM \S+/, `SELECT * FROM ${t}`), [ids])).rows;
    }
    for (const t of ORDER_ID_TABLES) {
      if (!(await tableExists(t))) continue;
      backup[t] = (await db.query(`SELECT * FROM "${t}" WHERE order_id = ANY($1::int[])`, [ids])).rows;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(backup, null, 2));
    console.log(`\nRespaldo: ${path.join(dir, 'backup.json')}`);

    await db.query('BEGIN');
    try {
      for (const { t, sql } of DELIVERY_DELETE) {
        if (!(await tableExists(t))) continue;
        const r = await db.query(sql, [ids]);
        console.log(`  borradas ${String(r.rowCount).padStart(5)} filas de ${t}`);
      }
      for (const t of ORDER_ID_TABLES) {
        if (!(await tableExists(t))) continue;
        const r = await db.query(`DELETE FROM "${t}" WHERE order_id = ANY($1::int[])`, [ids]);
        console.log(`  borradas ${String(r.rowCount).padStart(5)} filas de ${t}`);
      }
      const r = await db.query(`DELETE FROM orders WHERE status = ANY($1)`, [NEW_STATUSES]);
      console.log(`  borradas ${String(r.rowCount).padStart(5)} filas de orders`);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }

    const left = await db.query(
      `SELECT count(*)::int n FROM orders WHERE status = ANY($1)`,
      [NEW_STATUSES],
    );
    console.log(`\nPedidos "nuevos" tras la limpieza: ${left.rows[0].n}`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
