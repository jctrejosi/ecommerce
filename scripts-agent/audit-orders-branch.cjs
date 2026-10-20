/*
 * Auditoría: ¿todos los pedidos tienen sucursal asignada y válida?
 */
const { Client } = require('pg');
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };

(async () => {
  const db = new Client(DB);
  await db.connect();

  const nulls = await db.query(`SELECT COUNT(*)::int AS n FROM orders WHERE branch_id IS NULL`);
  console.log(`Pedidos con branch_id NULL: ${nulls.rows[0].n}`);

  const orphan = await db.query(
    `SELECT COUNT(*)::int AS n FROM orders o
      WHERE o.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = o.branch_id)`,
  );
  console.log(`Pedidos con branch_id inexistente en branches: ${orphan.rows[0].n}`);

  const notNull = await db.query(
    `SELECT is_nullable, data_type FROM information_schema.columns
      WHERE table_name='orders' AND column_name='branch_id'`,
  );
  console.log(`orders.branch_id -> ${JSON.stringify(notNull.rows[0])}`);

  const byBranch = await db.query(
    `SELECT COALESCE(b.name, '(sin sucursal)') AS sucursal, COUNT(*)::int AS n
       FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
      GROUP BY b.name ORDER BY n DESC`,
  );
  console.log('\nPedidos por sucursal:');
  for (const r of byBranch.rows) console.log(`  ${r.sucursal}: ${r.n}`);

  const byStatus = await db.query(
    `SELECT o.status, o.branch_id, COUNT(*)::int AS n
       FROM orders o
      WHERE o.status IN ('created','payment_pending','paid','preparing','ready')
      GROUP BY o.status, o.branch_id ORDER BY o.status, o.branch_id`,
  );
  console.log('\nPedidos activos (por estado y sucursal):');
  for (const r of byStatus.rows) console.log(`  ${r.status.padEnd(16)} branch=${r.branch_id}: ${r.n}`);

  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
