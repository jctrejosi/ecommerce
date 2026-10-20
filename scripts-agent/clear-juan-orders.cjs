/**
 * Limpia los pedidos asignados al picker "juan" (todos).
 *
 * - Hace respaldo JSON de lo que borra.
 * - Borra en orden hijo -> padre dentro de una transacción.
 * - Guarda anti-producción (se niega si la URL parece Supabase).
 *
 * Uso:
 *   NODE_PATH=backend/node_modules node scripts-agent/clear-juan-orders.cjs            # dry-run
 *   NODE_PATH=backend/node_modules node scripts-agent/clear-juan-orders.cjs --apply
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

// Hijos primero (FK) y `orders` al final. Las tablas de delivery cuelgan de
// shipments/assignments, no de order_id, así que se filtran con subconsultas.
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

// Tablas con columna order_id (refunds antes que payments por su FK).
const ORDER_ID_TABLES = [
  'refunds',
  'payments',
  'payment_intents',
  'invoices',
  'coupon_redemptions',
  'order_chat_messages',
  'order_status_history',
  'order_items',
  'shipments',
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
  try {
    const juan = await db.query(`SELECT id, username, first_name, last_name FROM users WHERE username = 'juan' LIMIT 1`);
    if (juan.rowCount === 0) throw new Error('No existe el usuario "juan".');
    const j = juan.rows[0];
    const juanId = Number(j.id);
    console.log(`Picker: #${juanId} ${j.username} (${j.first_name ?? ''} ${j.last_name ?? ''})`);

    const orders = await db.query(
      `SELECT id, reference_code, status FROM orders WHERE picker_id = $1 ORDER BY id`,
      [juanId],
    );
    const ids = orders.rows.map((r) => Number(r.id));
    const byStatus = {};
    for (const r of orders.rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    console.log(`\nPedidos asignados a juan: ${ids.length}`);
    console.log('  por estado:', JSON.stringify(byStatus));
    if (ids.length === 0) {
      console.log('\nNada que limpiar.');
      await db.end();
      return;
    }

    const tableExists = async (t) =>
      (await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [t],
      )).rowCount === 1;

    // Conteo de hijos que se borrarían.
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
      await db.end();
      return;
    }

    // Respaldo.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join('db', 'backups', 'juan-orders-cleanup', stamp);
    const backup = { orders: orders.rows };
    for (const { t, sql } of DELIVERY_DELETE) {
      if (!(await tableExists(t))) continue;
      const selectSql = sql.replace(/^DELETE FROM \S+/, `SELECT * FROM ${t}`);
      backup[t] = (await db.query(selectSql, [ids])).rows;
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
      const r = await db.query(`DELETE FROM orders WHERE picker_id = $1`, [juanId]);
      console.log(`  borradas ${String(r.rowCount).padStart(5)} filas de orders`);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }

    const left = await db.query(`SELECT count(*)::int AS n FROM orders WHERE picker_id = $1`, [juanId]);
    console.log(`\nPedidos de juan tras la limpieza: ${left.rows[0].n}`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
