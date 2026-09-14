/**
 * Inspección (solo lectura) del estado de usuarios y sus dependencias.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/inspect-users.cjs
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const TABLES_WITH_FK_TO_USERS = [
  ['media', 'uploaded_by'],
  ['prices', 'changed_by'],
  ['inventory_movements', 'performed_by'],
  ['inventory_reservations', 'created_by'],
  ['order_status_history', 'picker_id'],
  ['refunds', 'processed_by'],
  ['promotions', 'created_by'],
  ['pages', 'created_by'],
  ['pages', 'updated_by'],
  ['audit_logs', 'performed_by'],
  ['product_tax_classes', 'assigned_by'],
];

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const host = DATABASE_URL.replace(/\/\/[^@]*@/, '//***@').split('?')[0];
    const version = await db.query('SELECT current_database() AS db, version() AS v');
    console.log('Conexión:', host);
    console.log('DB:', version.rows[0].db, '|', version.rows[0].v.split(',')[0]);

    const users = await db.query(
      `SELECT id, username, email, is_superuser, is_picker, is_active,
              deleted_at IS NOT NULL AS deleted
       FROM users ORDER BY id`,
    );
    console.log(`\nUSERS (${users.rowCount}):`);
    for (const u of users.rows) {
      console.log(
        `  #${u.id} ${String(u.username).padEnd(24)} super=${u.is_superuser} picker=${u.is_picker} active=${u.is_active} del=${u.deleted}`,
      );
    }

    const drivers = await db.query(
      `SELECT d.id, d.auth_user_id, u.username, d.is_active, d.deleted_at IS NOT NULL AS deleted,
              (SELECT count(*) FROM delivery_assignments a WHERE a.driver_id = d.id) AS assignments
       FROM delivery_drivers d
       LEFT JOIN users u ON u.id = d.auth_user_id
       ORDER BY d.id`,
    );
    console.log(`\nDELIVERY_DRIVERS (${drivers.rowCount}):`);
    for (const d of drivers.rows) {
      console.log(
        `  #${d.id} user=${d.username} (${d.auth_user_id}) active=${d.is_active} del=${d.deleted} asignaciones=${d.assignments}`,
      );
    }

    console.log('\nREFERENCIAS FK -> users (tablas RESTRICT/SET NULL):');
    for (const [table, col] of TABLES_WITH_FK_TO_USERS) {
      try {
        const r = await db.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE ${col} IS NOT NULL`,
        );
        console.log(`  ${table}.${col}: ${r.rows[0].n} filas con valor`);
      } catch (e) {
        console.log(`  ${table}.${col}: ERROR ${e.message}`);
      }
    }

    const roles = await db.query('SELECT count(*)::int AS n FROM roles');
    const perms = await db.query('SELECT count(*)::int AS n FROM permissions');
    console.log(`\nroles=${roles.rows[0].n} permissions=${perms.rows[0].n}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
