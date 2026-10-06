/*
 * ¿Los pickers están asociados a sucursales?
 * Revisa la tabla puente user_branches y lista los pickers con sus sucursales.
 */
const { Client } = require('pg');

const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };

(async () => {
  const db = new Client(DB);
  await db.connect();

  const total = await db.query(`SELECT COUNT(*)::int AS n FROM user_branches`);
  console.log(`Filas en user_branches: ${total.rows[0].n}`);

  const pickers = await db.query(
    `SELECT u.id, u.username, u.is_picker,
            COALESCE(string_agg(b.name, ', ' ORDER BY b.name), '—') AS sucursales
       FROM users u
       LEFT JOIN user_branches ub ON ub.user_id = u.id
       LEFT JOIN branches b ON b.id = ub.branch_id
      WHERE u.is_picker = true AND u.deleted_at IS NULL
      GROUP BY u.id, u.username, u.is_picker
      ORDER BY u.id`,
  );
  console.log(`\nPickers (${pickers.rows.length}):`);
  for (const r of pickers.rows) {
    console.log(`  #${r.id} ${r.username.padEnd(22)} -> ${r.sucursales}`);
  }

  // ¿Todos los pedidos en preparing pertenecen a una sola sucursal?
  const byBranch = await db.query(
    `SELECT b.name, COUNT(*)::int AS n
       FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.status = 'preparing'
      GROUP BY b.name ORDER BY n DESC`,
  );
  console.log(`\nPedidos "preparing" por sucursal:`);
  for (const r of byBranch.rows) console.log(`  ${r.name ?? '(sin sucursal)'}: ${r.n}`);

  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
