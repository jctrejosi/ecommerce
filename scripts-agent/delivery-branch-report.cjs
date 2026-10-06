/**
 * Reporte acotado para la tarea de sucursales en delivery: sucursales, admins
 * (superusuario con/sin sucursal) y repartidores con su sucursal. Solo imprime
 * agregados y muestras cortas (nunca volcados grandes).
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

  const branches = await db.query(
    `SELECT id, code, name, is_active FROM branches WHERE deleted_at IS NULL ORDER BY priority, name`,
  );
  console.log(`\nSucursales (${branches.rows.length}):`);
  for (const b of branches.rows) {
    console.log(`  #${b.id} code=${b.code} ${b.name} (activa=${b.is_active})`);
  }

  const admins = await db.query(
    `SELECT u.id, u.username, u.is_superuser, u.is_picker, b.id AS branch_id, b.name AS branch_name
       FROM users u
       LEFT JOIN user_branches ub ON ub.user_id = u.id
       LEFT JOIN branches b ON b.id = ub.branch_id
      WHERE u.deleted_at IS NULL AND u.is_superuser = true
      ORDER BY u.id`,
  );
  console.log(`\nSuperusuarios (${admins.rows.length}):`);
  for (const a of admins.rows) {
    console.log(
      `  #${a.id} ${String(a.username).padEnd(16)} -> ${a.branch_name ?? 'GLOBAL (sin sucursal)'}`,
    );
  }

  const drivers = await db.query(
    `SELECT d.id, d.full_name, d.auth_user_id, ub.branch_id, b.name AS branch_name
       FROM delivery_drivers d
       LEFT JOIN user_branches ub ON ub.user_id = d.auth_user_id
       LEFT JOIN branches b ON b.id = ub.branch_id
      WHERE d.deleted_at IS NULL
      ORDER BY d.id`,
  );
  const withBranch = drivers.rows.filter((d) => d.branch_id != null).length;
  console.log(
    `\nRepartidores (${drivers.rows.length}); con sucursal: ${withBranch}, sin sucursal: ${drivers.rows.length - withBranch}`,
  );
  for (const d of drivers.rows.slice(0, 10)) {
    console.log(
      `  #${d.id} ${String(d.full_name).padEnd(22)} auth=${d.auth_user_id ?? '-'} -> ${d.branch_name ?? 'SIN SUCURSAL'}`,
    );
  }

  const ordersByBranch = await db.query(
    `SELECT o.branch_id, b.name AS branch_name, count(*)::int AS n
       FROM orders o
       LEFT JOIN branches b ON b.id = o.branch_id
      GROUP BY o.branch_id, b.name
      ORDER BY n DESC`,
  );
  console.log('\nPedidos por sucursal (top 8):');
  for (const r of ordersByBranch.rows.slice(0, 8)) {
    console.log(`  ${r.branch_name ?? `branch ${r.branch_id}`}: ${r.n}`);
  }

  await db.end();
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
