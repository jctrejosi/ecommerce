#!/usr/bin/env node
/**
 * Borra los pedidos DEMO (reference_code LIKE 'DEMO%') y todas sus filas hijas.
 *
 * - Dry-run por defecto. Con --apply ejecuta.
 * - Respalda en JSON todo lo que borra, antes de borrar.
 * - Borra hijo -> padre en una transacción, en el orden que exigen las FKs
 *   (verificado contra information_schema el 2026-11).
 *
 * Uso local (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/delete-demo-orders.cjs
 *   NODE_PATH=backend/node_modules node scripts-agent/delete-demo-orders.cjs --apply
 *
 * Uso en el servidor (dentro del contenedor mercaldas_app):
 *   node /tmp/delete-demo-orders.cjs --apply --out=/tmp/demo-cleanup
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const fs = require('node:fs');
const path = require('node:path');

function loadPg() {
  const candidates = [
    resolve(__dirname, '../backend/package.json'),
    '/app/backend/package.json',
    resolve(process.cwd(), 'backend/package.json'),
  ];
  for (const c of candidates) {
    try {
      return createRequire(c)('pg');
    } catch {
      /* siguiente */
    }
  }
  return require('pg');
}

const { Client } = loadPg();

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const APPLY = process.argv.includes('--apply');
const OUT_ARG = process.argv.find((a) => a.startsWith('--out='));
const OUT_DIR = OUT_ARG ? OUT_ARG.slice('--out='.length) : path.join('db', 'backups', 'demo-orders-cleanup');
const PREFIX = 'DEMO';

// Hijo -> padre. Cada entrada se borra con el predicado indicado sobre los
// pedidos demo ($1 = int[] con los ids de orders).
const STEPS = [
  {
    t: 'delivery_events',
    where: `assignment_id IN (SELECT id FROM delivery_assignments WHERE shipment_id IN (
      SELECT id FROM shipments WHERE order_id = ANY($1::int[])))`,
  },
  {
    t: 'delivery_proof_media',
    where: `assignment_id IN (SELECT id FROM delivery_assignments WHERE shipment_id IN (
      SELECT id FROM shipments WHERE order_id = ANY($1::int[])))`,
  },
  {
    t: 'delivery_assignments',
    where: `shipment_id IN (SELECT id FROM shipments WHERE order_id = ANY($1::int[]))`,
  },
  { t: 'refunds', where: 'order_id = ANY($1::int[])' },
  { t: 'payments', where: 'order_id = ANY($1::int[])' },
  { t: 'payment_intents', where: 'order_id = ANY($1::int[])' },
  { t: 'invoices', where: 'order_id = ANY($1::int[])' },
  { t: 'coupon_transactions', where: 'order_id = ANY($1::int[])' },
  { t: 'coupon_redemptions', where: 'order_id = ANY($1::int[])' },
  { t: 'order_chat_messages', where: 'order_id = ANY($1::int[])' },
  { t: 'order_status_history', where: 'order_id = ANY($1::int[])' },
  { t: 'order_items', where: 'order_id = ANY($1::int[])' },
  { t: 'picker_break_ledger', where: 'order_id = ANY($1::int[])' },
  { t: 'shipments', where: 'order_id = ANY($1::int[])' },
];

async function tableExists(db, t) {
  const r = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [t],
  );
  return r.rowCount === 1;
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const who = await db.query('SELECT current_database() AS db');
    console.log(`DB: ${who.rows[0].db}`);

    const orders = await db.query(
      `SELECT * FROM orders WHERE reference_code LIKE $1 ORDER BY id`,
      [`${PREFIX}%`],
    );
    const ids = orders.rows.map((r) => Number(r.id));
    console.log(`Pedidos ${PREFIX}*: ${ids.length}`);
    if (ids.length === 0) {
      console.log('Nada que borrar.');
      return;
    }

    const byStatus = {};
    for (const r of orders.rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    console.log('  por estado:', JSON.stringify(byStatus));

    // Conteo previo de hijos
    const counts = {};
    for (const s of STEPS) {
      if (!(await tableExists(db, s.t))) continue;
      const r = await db.query(`SELECT count(*)::int AS n FROM "${s.t}" WHERE ${s.where}`, [ids]);
      counts[s.t] = r.rows[0].n;
    }
    console.log('\nFilas hijas:', JSON.stringify(counts));

    if (!APPLY) {
      console.log('\nDRY-RUN: nada borrado. Ejecuta con --apply.');
      return;
    }

    // Respaldo
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(OUT_DIR, stamp);
    const backup = { generated_at: new Date().toISOString(), database: who.rows[0].db, orders: orders.rows };
    for (const s of STEPS) {
      if (!(await tableExists(db, s.t))) continue;
      backup[s.t] = (await db.query(`SELECT * FROM "${s.t}" WHERE ${s.where}`, [ids])).rows;
    }
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'backup.json');
    fs.writeFileSync(file, JSON.stringify(backup));
    console.log(`\nRespaldo: ${file}`);

    await db.query('BEGIN');
    try {
      for (const s of STEPS) {
        if (!(await tableExists(db, s.t))) continue;
        const r = await db.query(`DELETE FROM "${s.t}" WHERE ${s.where}`, [ids]);
        console.log(`  borradas ${String(r.rowCount).padStart(5)} de ${s.t}`);
      }
      const r = await db.query('DELETE FROM orders WHERE id = ANY($1::int[])', [ids]);
      console.log(`  borradas ${String(r.rowCount).padStart(5)} de orders`);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }

    const left = await db.query('SELECT count(*)::int AS n FROM orders WHERE reference_code LIKE $1', [
      `${PREFIX}%`,
    ]);
    console.log(`\nPedidos ${PREFIX}* restantes: ${left.rows[0].n}`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
