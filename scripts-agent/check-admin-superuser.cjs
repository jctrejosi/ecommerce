/**
 * Inspección (solo lectura) del estado de superuser/roles de los usuarios admin.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/check-admin-superuser.cjs
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const users = await db.query(
      `SELECT id, username, email, is_superuser, is_active,
              deleted_at IS NOT NULL AS deleted
       FROM users
       ORDER BY id`,
    );
    console.log(`USERS (${users.rowCount}):`);
    for (const u of users.rows) {
      console.log(
        `  #${u.id} ${String(u.username).padEnd(24)} super=${u.is_superuser} active=${u.is_active} del=${u.deleted} ${u.email}`,
      );
    }

    let roles = { rows: [] };
    try {
      roles = await db.query(
        `SELECT u.id, u.username, u.is_superuser,
                COALESCE(string_agg(r.name, ', ' ORDER BY r.name), '(sin roles)') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.id, u.username, u.is_superuser
         ORDER BY u.id`,
      );
      console.log('\nROLES POR USUARIO:');
      for (const r of roles.rows) {
        console.log(`  #${r.id} ${String(r.username).padEnd(24)} -> ${r.roles}`);
      }
    } catch (e) {
      console.log(`\n(user_roles/roles no consultable: ${e.message})`);
    }

    const defRoles = await db.query(
      `SELECT id, name, description, is_system FROM roles ORDER BY id`,
    );
    console.log(`\nROLES DEFINIDOS (${defRoles.rowCount}):`);
    for (const r of defRoles.rows) {
      console.log(`  #${r.id} ${String(r.name).padEnd(20)} system=${r.is_system}`);
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
