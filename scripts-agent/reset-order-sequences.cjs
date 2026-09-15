/**
 * Reinicia a 1 las secuencias (id) de todas las tablas de pedidos.
 * Solo tiene sentido tras vaciarlas con clean-orders.cjs.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/reset-order-sequences.cjs --dry-run
 *   NODE_PATH=backend/node_modules node scripts-agent/reset-order-sequences.cjs
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const DRY_RUN = process.argv.includes('--dry-run');

const TABLES = [
  'delivery_events',
  'delivery_proof_media',
  'delivery_assignments',
  'refunds',
  'payments',
  'payment_intents',
  'invoices',
  'coupon_redemptions',
  'order_chat_messages',
  'order_status_history',
  'order_items',
  'shipments',
  'orders',
];

function guard(url) {
  const l = url.toLowerCase();
  if (l.includes('supabase') || l.includes('pooler')) {
    throw new Error('URL apunta a PRODUCCIÓN (Supabase). Abortado.');
  }
}

async function main() {
  guard(DATABASE_URL);
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const who = await db.query('SELECT current_database() AS db');
    console.log(`DB: ${who.rows[0].db} | ${DRY_RUN ? 'DRY-RUN' : 'APLICAR'}\n`);

    await db.query('BEGIN');
    try {
      for (const t of TABLES) {
        const exists = await db.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
          [t],
        );
        if (exists.rowCount === 0) {
          console.log(`  ${t.padEnd(24)} (no existe)`);
          continue;
        }
        // La tabla debe estar vacía para no reiniciar a un id ya usado.
        const cnt = await db.query(`SELECT count(*)::int AS n FROM "${t}"`);
        if (cnt.rows[0].n > 0) {
          console.log(`  ${t.padEnd(24)} OMITIDA (${cnt.rows[0].n} filas, no está vacía)`);
          continue;
        }
        const seq = await db.query(
          `SELECT pg_get_serial_sequence($1, 'id') AS s`,
          [`public.${t}`],
        );
        const s = seq.rows[0].s;
        if (!s) {
          console.log(`  ${t.padEnd(24)} (sin secuencia en id)`);
          continue;
        }
        await db.query(`ALTER SEQUENCE ${s} RESTART WITH 1`);
        const val = await db.query(
          `SELECT last_value, is_called FROM ${s.replace('public.', 'public.')}`,
        );
        console.log(`  ${t.padEnd(24)} -> ${s} reiniciada a 1`);
      }
      if (DRY_RUN) {
        await db.query('ROLLBACK');
        console.log('\nDRY-RUN: rollback, nada cambió.');
      } else {
        await db.query('COMMIT');
        console.log('\nSecuencias reiniciadas.');
      }
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
