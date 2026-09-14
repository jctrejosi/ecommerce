/**
 * Asigna a juan el rol "Picking y Delivery" (picking:* + delivery:*).
 * admin conserva el rol "Administrador" (todos los permisos).
 *
 * Idempotente: crea el rol si no existe, reemplaza sus permisos y asigna a juan.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/assign-juan-role.cjs          # dry-run
 *   APPLY=1 NODE_PATH=backend/node_modules node scripts-agent/assign-juan-role.cjs  # aplica
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const APPLY = process.env.APPLY === '1';

const ROLE_NAME = 'Picking y Delivery';
const ROLE_DESC = 'Acceso operativo a picking y delivery (app móvil).';

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');

    const juan = await db.query(`SELECT id FROM users WHERE username = 'juan' LIMIT 1`);
    if (juan.rowCount === 0) throw new Error('El usuario "juan" no existe.');
    const juanId = Number(juan.rows[0].id);

    // Crear/obtener el rol.
    const existing = await db.query(`SELECT id FROM roles WHERE name = $1`, [ROLE_NAME]);
    let roleId;
    if (existing.rowCount > 0) {
      roleId = Number(existing.rows[0].id);
      await db.query(`UPDATE roles SET description = $1 WHERE id = $2`, [ROLE_DESC, roleId]);
      console.log(`Rol existente: #${roleId} ${ROLE_NAME}`);
    } else {
      const ins = await db.query(
        `INSERT INTO roles (name, description, is_system) VALUES ($1, $2, false) RETURNING id`,
        [ROLE_NAME, ROLE_DESC],
      );
      roleId = Number(ins.rows[0].id);
      console.log(`Rol creado: #${roleId} ${ROLE_NAME}`);
    }

    // Permisos picking:* + delivery:*.
    const perms = await db.query(
      `SELECT id, code FROM permissions WHERE module IN ('picking', 'delivery') ORDER BY code`,
    );
    const permIds = perms.rows.map((r) => Number(r.id));

    await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    for (const pid of permIds) {
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [roleId, pid],
      );
    }
    console.log(`Permisos asignados al rol: ${permIds.length}`);

    // Asignar a juan.
    await db.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [juanId, roleId],
    );

    // ── VALIDACIÓN ─────────────────────────────────────────────────────────
    console.log('\n===== VALIDACIÓN =====');
    const roles = await db.query(
      `SELECT r.id, r.name, r.is_system,
              count(rp.permission_id)::int AS nperms,
              array_agg(p.code ORDER BY p.code) AS codes
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.id, r.name, r.is_system
       ORDER BY r.name`,
    );
    console.log('Roles y permisos:');
    for (const r of roles.rows) {
      console.log(`  ${r.name}${r.is_system ? ' (sistema)' : ''} — ${r.nperms} permisos`);
      if (r.codes) console.log(`    ${r.codes.join(', ')}`);
    }

    const userRoles = await db.query(
      `SELECT u.username, array_agg(r.name ORDER BY r.name) AS roles
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       JOIN roles r ON r.id = ur.role_id
       GROUP BY u.username
       ORDER BY u.username`,
    );
    console.log('\nRoles por usuario:');
    for (const ur of userRoles.rows) {
      console.log(`  ${ur.username} → ${ur.roles.join(', ')}`);
    }

    if (APPLY) {
      await db.query('COMMIT');
      console.log('\n✅ Aplicado (COMMIT).');
    } else {
      await db.query('ROLLBACK');
      console.log('\n(dry-run: ROLLBACK, no se aplicó nada. Usa APPLY=1 para aplicar.)');
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
