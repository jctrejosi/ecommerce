/**
 * Deja exactamente 2 usuarios y valida roles/permisos:
 *   - admin / admdsi1234 → superusuario + rol "Administrador" (todos los permisos de los 3 admin)
 *   - juan  / juan4231   → picker (app picking) + repartidor (app delivery)
 *
 * Elimina cualquier otro usuario y sus perfiles/asignaciones de repartidor.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/clean-users.cjs          # dry-run
 *   APPLY=1 NODE_PATH=backend/node_modules node scripts-agent/clean-users.cjs  # aplica
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const APPLY = process.env.APPLY === '1';

const ADMIN = {
  username: 'admin',
  email: 'admin@mercaldas.com.co',
  firstName: 'Admin',
  lastName: 'Global',
  password: 'admdsi4231',
  isSuperuser: true,
  isPicker: false,
};

const JUAN = {
  username: 'juan',
  email: 'juan@mercaldas.com.co',
  firstName: 'Juan',
  lastName: '',
  password: 'juan4231',
  isSuperuser: false,
  isPicker: true,
};

async function upsertUser(db, u) {
  const passwordHash = await bcrypt.hash(u.password, 10);
  const r = await db.query(
    `INSERT INTO users
       (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     ON CONFLICT (email) DO UPDATE SET
       username = EXCLUDED.username,
       password_hash = EXCLUDED.password_hash,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       is_superuser = EXCLUDED.is_superuser,
       is_active = true,
       is_picker = EXCLUDED.is_picker,
       deleted_at = NULL,
       locked_until = NULL,
       filed_attempts = 0,
       updated_at = now()
     RETURNING id`,
    [u.email, u.username, passwordHash, u.firstName, u.lastName, u.isSuperuser, u.isPicker],
  );
  return Number(r.rows[0].id);
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');

    const adminId = await upsertUser(db, ADMIN);
    const juanId = await upsertUser(db, JUAN);
    console.log(`admin id=${adminId} | juan id=${juanId}`);

    // Usuarios a eliminar (todo lo que no sea admin/juan).
    const others = await db.query(
      `SELECT id, username FROM users WHERE id <> $1 AND id <> $2 ORDER BY id`,
      [adminId, juanId],
    );
    const othersIds = others.rows.map((r) => Number(r.id));
    console.log(`Usuarios a eliminar (${othersIds.length}): ${others.rows.map((r) => r.username).join(', ') || '—'}`);

    if (othersIds.length) {
      // Repartidores vinculados a esos usuarios.
      const drivers = await db.query(
        `SELECT id FROM delivery_drivers WHERE auth_user_id = ANY($1::bigint[])`,
        [othersIds],
      );
      const driverIds = drivers.rows.map((r) => Number(r.id));

      // 1) Asignaciones de esos repartidores (FK RESTRICT).
      if (driverIds.length) {
        const a = await db.query(
          `DELETE FROM delivery_assignments WHERE driver_id = ANY($1::bigint[])`,
          [driverIds],
        );
        console.log(`  delivery_assignments eliminadas: ${a.rowCount}`);
      }

      // 2) Perfiles de repartidor (locations se borran por CASCADE).
      const d = await db.query(
        `DELETE FROM delivery_drivers WHERE auth_user_id = ANY($1::bigint[])`,
        [othersIds],
      );
      console.log(`  repartidores eliminados: ${d.rowCount}`);

      // 3) Reasignar FKs con datos hacia el admin conservado.
      await db.query(`UPDATE media SET uploaded_by = $1 WHERE uploaded_by = ANY($2::bigint[])`, [adminId, othersIds]);
      await db.query(`UPDATE prices SET changed_by = $1 WHERE changed_by = ANY($2::bigint[])`, [adminId, othersIds]);

      // 4) Usuarios.
      const u = await db.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [othersIds]);
      console.log(`  usuarios eliminados: ${u.rowCount}`);
    }

    // Perfil de repartidor para juan.
    const drv = await db.query(
      `INSERT INTO delivery_drivers
         (full_name, phone, email, auth_user_id, vehicle_type, is_available, is_active)
       SELECT 'Juan', '3000000000', $1, $2, 'MOTO', true, true
       WHERE NOT EXISTS (SELECT 1 FROM delivery_drivers WHERE auth_user_id = $2)`,
      [JUAN.email, juanId],
    );
    await db.query(
      `UPDATE delivery_drivers SET is_active = true, is_available = true, deleted_at = NULL WHERE auth_user_id = $1`,
      [juanId],
    );
    if (drv.rowCount) console.log('  perfil de repartidor de juan creado');
    else console.log('  perfil de repartidor de juan actualizado');

    // Rol "Administrador" para admin (todos los permisos de los 3 admin).
    const role = await db.query(`SELECT id FROM roles WHERE name = 'Administrador' LIMIT 1`);
    if (role.rowCount > 0) {
      await db.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [adminId, role.rows[0].id],
      );
      console.log('  rol Administrador asignado a admin');
    } else {
      console.log('  ⚠️ rol Administrador no encontrado (¿seed del backend?)');
    }

    // Revocar sesiones/tokens para forzar re-login con las nuevas claves.
    await db.query(`DELETE FROM user_refresh_tokens WHERE user_id = ANY($1::bigint[])`, [[adminId, juanId]]);
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])`, [[adminId, juanId]]);

    // ── VALIDACIÓN ─────────────────────────────────────────────────────────
    console.log('\n===== VALIDACIÓN =====');
    const users = await db.query(
      `SELECT id, username, is_superuser, is_picker, is_active
       FROM users WHERE deleted_at IS NULL ORDER BY id`,
    );
    console.log('Usuarios finales:');
    for (const u of users.rows) {
      const pw = await bcrypt.compare(
        u.username === 'admin' ? ADMIN.password : JUAN.password,
        (await db.query('SELECT password_hash FROM users WHERE id = $1', [u.id])).rows[0].password_hash,
      );
      console.log(`  #${u.id} ${String(u.username).padEnd(8)} super=${u.is_superuser} picker=${u.is_picker} active=${u.is_active} password=${pw ? 'OK' : 'FALLA'}`);
    }

    const drivers = await db.query(
      `SELECT d.id, u.username FROM delivery_drivers d JOIN users u ON u.id = d.auth_user_id ORDER BY d.id`,
    );
    console.log(`Repartidores: ${drivers.rows.map((d) => `#${d.id}:${d.username}`).join(', ') || '—'}`);

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
    console.log('\nRoles y permisos:');
    for (const r of roles.rows) {
      console.log(`  ${r.name}${r.is_system ? ' (sistema)' : ''} — ${r.nperms} permisos`);
      if (r.codes) console.log(`    ${r.codes.join(', ')}`);
    }

    const totalPerms = await db.query(`SELECT count(*)::int AS n FROM permissions`);
    console.log(`\nTotal permisos en catálogo: ${totalPerms.rows[0].n}`);

    const userRoles = await db.query(
      `SELECT u.username, r.name AS role
       FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id
       ORDER BY u.username, r.name`,
    );
    console.log('Asignaciones usuario→rol:');
    if (userRoles.rowCount === 0) console.log('  (ninguna)');
    for (const ur of userRoles.rows) console.log(`  ${ur.username} → ${ur.role}`);

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
