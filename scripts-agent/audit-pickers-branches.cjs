/*
 * Auditoría de usuarios picker vs sucursal.
 */
const { Client } = require('pg');
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };

(async () => {
  const db = new Client(DB);
  await db.connect();

  const pickers = await db.query(
    `SELECT u.id, u.username, u.is_picker, u.is_superuser, u.is_active, u.deleted_at,
            b.id AS branch_id, b.name AS branch
       FROM users u
       LEFT JOIN user_branches ub ON ub.user_id = u.id
       LEFT JOIN branches b ON b.id = ub.branch_id
      WHERE u.is_picker = true AND u.deleted_at IS NULL
      ORDER BY u.id`,
  );
  console.log(`Pickers (is_picker=true, ${pickers.rows.length}):`);
  console.table(pickers.rows.map((r) => ({ id: r.id, user: r.username, super: r.is_superuser, branch_id: r.branch_id, branch: r.branch ?? '— SIN SUCURSAL' })));

  const branches = await db.query(
    `SELECT b.id, b.code, b.name, b.is_active,
            COUNT(ub.user_id)::int AS pickers
       FROM branches b
       LEFT JOIN user_branches ub ON ub.branch_id = b.id
       LEFT JOIN users u ON u.id = ub.user_id AND u.is_picker = true AND u.deleted_at IS NULL
       GROUP BY b.id ORDER BY b.id`,
  );
  console.log('\nSucursales y pickers asignados:');
  console.table(branches.rows);

  const noPickers = branches.rows.filter((r) => r.is_active && r.pickers === 0);
  console.log(`\nSucursales activas sin picker: ${noPickers.length ? noPickers.map((b) => b.name).join(', ') : 'ninguna'}`);

  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
