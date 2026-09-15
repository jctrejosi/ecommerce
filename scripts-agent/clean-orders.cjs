/**
 * Limpia TODOS los pedidos (de todos los clientes) en la base LOCAL.
 *
 * - Hace respaldo JSON de todas las filas afectadas ANTES de borrar.
 * - Borra en orden hijo -> padre dentro de UNA transacción.
 * - GUARDA ANTI-PRODUCCIÓN: se niega a ejecutar si el host parece Supabase.
 * - NO toca customers, products ni usuarios.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/clean-orders.cjs --dry-run
 *   NODE_PATH=backend/node_modules node scripts-agent/clean-orders.cjs
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const DRY_RUN = process.argv.includes('--dry-run');

// Orden de borrado: hijos primero, respetando FKs RESTRICT internas
// (refunds -> payments -> payment_intents, y payments/refunds/invoices -> orders).
const DELETE_ORDER = [
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

// `orders.completed_at` puede no existir en algunas versiones; no lo tocamos.

function guard(databaseUrl) {
  const lower = databaseUrl.toLowerCase();
  if (lower.includes('supabase') || lower.includes('pooler')) {
    throw new Error(
      'La URL apunta a PRODUCCIÓN (Supabase). Este script solo limpia la base LOCAL. Abortado.',
    );
  }
}

async function main() {
  guard(DATABASE_URL);
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const who = await db.query('SELECT current_database() AS db');
    console.log(`DB destino: ${who.rows[0].db}  |  modo: ${DRY_RUN ? 'DRY-RUN (no borra)' : 'BORRADO REAL'}`);

    const existing = [];
    for (const t of DELETE_ORDER) {
      const r = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [t],
      );
      if (r.rowCount === 1) existing.push(t);
    }

    // Respaldo JSON
    const backup = {};
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join('db', 'backups', 'orders-cleanup', stamp);
    for (const t of existing) {
      const r = await db.query(`SELECT * FROM "${t}"`);
      backup[t] = r.rows;
    }
    const totalRows = Object.values(backup).reduce((a, b) => a + b.length, 0);
    if (!DRY_RUN && totalRows > 0) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(backup, null, 2));
      console.log(`Respaldo: ${path.join(dir, 'backup.json')} (${totalRows} filas)`);
    } else {
      console.log(`Respaldo: no escrito (${totalRows} filas, modo dry-run o nada que borrar)`);
    }

    console.log('\n== Antes ==');
    for (const t of existing) console.log(`  ${t.padEnd(24)} ${String(backup[t].length).padStart(7)}`);

    if (DRY_RUN) {
      console.log('\nDRY-RUN: no se borró nada.');
      return;
    }

    await db.query('BEGIN');
    try {
      for (const t of existing) {
        const r = await db.query(`DELETE FROM "${t}"`);
        console.log(`  borradas ${String(r.rowCount).padStart(7)} filas de ${t}`);
      }
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }

    console.log('\n== Después ==');
    for (const t of ['orders', 'order_items', 'shipments', 'payments', 'customers']) {
      const r = await db.query(`SELECT count(*)::int AS n FROM "${t}"`);
      console.log(`  ${t.padEnd(24)} ${String(r.rows[0].n).padStart(7)}`);
    }
    console.log('\nListo: pedidos vaciados. Clientes, productos y usuarios intactos.');
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
