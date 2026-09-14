/**
 * Limpia los usuarios del sistema y deja exactamente 2:
 *   - admin / admin4231  → superusuario (entra a web admin, delivery admin y picking admin)
 *   - juan  / juan1234   → picker (app móvil de picking) + repartidor (app móvil delivery)
 *
 * Reutiliza la fila del admin global existente (email admin@mercaldas.com.co) para
 * no romper las FK con datos (media.uploaded_by, prices.changed_by). Borra el resto
 * de usuarios y sus perfiles de repartidor.
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
  password: 'admin4231',
  isSuperuser: true,
  isPicker: false,
};

const JUAN = {
  username: 'juan',
  email: 'juan@mercaldas.com.co',
  firstName: 'Juan',
  lastName: '',
  password: 'juan1234',
  isSuperuser: false,
  isPicker: true,
};

const DELETE_RULE = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};

async function fksToUsers(db) {
  const r = await db.query(`
    SELECT c.conname,
           tc.relname AS table_name,
           a.attname  AS column_name,
           c.confdeltype AS delete_action,
           a.attnotnull  AS not_null
    FROM pg_constraint c
    JOIN pg_class tc ON tc.oid = c.conrelid
    JOIN pg_class rc ON rc.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND rc.relname = 'users'
    ORDER BY tc.relname, a.attname
  `);
  return r.rows;
}

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

    const fks = await fksToUsers(db);
    console.log(`FK -> users encontradas: ${fks.length}`);
    const blockers = [];
    for (const fk of fks) {
      const rule = DELETE_RULE[fk.delete_action] || fk.delete_action;
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM ${fk.table_name} WHERE ${fk.column_name} IS NOT NULL`,
      );
      if (rows[0].n > 0) {
        console.log(
          `  ${fk.table_name}.${fk.column_name}: ${rows[0].n} filas (on delete ${rule}${fk.not_null ? ', NOT NULL' : ''})`,
        );
        if (fk.delete_action === 'n' || fk.delete_action === 'c') continue;
        blockers.push({ ...fk, n: rows[0].n, rule });
      }
    }

    // 1. Upsert admin (reutiliza la fila existente por email) y juan.
    const adminId = await upsertUser(db, ADMIN);
    const juanId = await upsertUser(db, JUAN);
    console.log(`\nadmin id=${adminId} | juan id=${juanId}`);

    // 2. Reasignar a admin las FK bloqueantes que apunten a usuarios a borrar.
    const others = await db.query(
      `SELECT id, username FROM users WHERE id <> $1 AND id <> $2 ORDER BY id`,
      [adminId, juanId],
    );
    const othersIds = others.rows.map((r) => Number(r.id));
    console.log(`Usuarios a eliminar (${othersIds.length}): ${others.rows.map((r) => r.username).join(', ') || '—'}`);

    for (const fk of blockers) {
      if (othersIds.length === 0) break;
      const res = await db.query(
        `UPDATE ${fk.table_name} SET ${fk.column_name} = $1 WHERE ${fk.column_name} = ANY($2::bigint[])`,
        [adminId, othersIds],
      );
      console.log(`  reasignadas ${res.rowCount} filas en ${fk.table_name}.${fk.column_name} -> admin`);
    }

    // 3. Eliminar perfiles de repartidor de los usuarios a borrar.
    if (othersIds.length) {
      const drv = await db.query(
        `DELETE FROM delivery_drivers WHERE auth_user_id = ANY($1::bigint[])`,
        [othersIds],
      );
      console.log(`  repartidores eliminados: ${drv.rowCount}`);
    }

    // 4. Eliminar el resto de usuarios.
    if (othersIds.length) {
      const del = await db.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [othersIds]);
      console.log(`  usuarios eliminados: ${del.rowCount}`);
    }

    // 5. Perfil de repartidor para juan.
    const existingDriver = await db.query(
      `SELECT id FROM delivery_drivers WHERE auth_user_id = $1 LIMIT 1`,
      [juanId],
    );
    if (existingDriver.rowCount === 0) {
      await db.query(
        `INSERT INTO delivery_drivers
           (full_name, phone, email, auth_user_id, vehicle_type, is_available, is_active)
         VALUES ($1, $2, $3, $4, 'MOTO', true, true)`,
        ['Juan', '3000000000', JUAN.email, juanId],
      );
      console.log('  perfil de repartidor creado para juan');
    } else {
      await db.query(
        `UPDATE delivery_drivers SET is_active = true, deleted_at = NULL WHERE auth_user_id = $1`,
        [juanId],
      );
      console.log('  perfil de repartidor de juan actualizado');
    }

    // 6. Rol por defecto para admin.
    const adminRole = await db.query(`SELECT id FROM roles WHERE name = 'Administrador' LIMIT 1`);
    if (adminRole.rowCount > 0) {
      await db.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [adminId, adminRole.rows[0].id],
      );
      console.log('  rol Administrador asignado a admin');
    }

    // 7. Revocar sesiones/tokens (forzar re-login).
    await db.query(`DELETE FROM user_refresh_tokens WHERE user_id = ANY($1::bigint[])`, [
      [adminId, juanId],
    ]);
    await db.query(`DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])`, [
      [adminId, juanId],
    ]);

    const final = await db.query(
      `SELECT id, username, email, is_superuser, is_picker, is_active
       FROM users WHERE deleted_at IS NULL ORDER BY id`,
    );
    console.log('\nUsuarios finales:');
    for (const u of final.rows) {
      console.log(
        `  #${u.id} ${String(u.username).padEnd(10)} super=${u.is_superuser} picker=${u.is_picker} active=${u.is_active} <${u.email}>`,
      );
    }
    const drivers = await db.query(
      `SELECT d.id, u.username FROM delivery_drivers d JOIN users u ON u.id = d.auth_user_id ORDER BY d.id`,
    );
    console.log(`Repartidores: ${drivers.rows.map((d) => `#${d.id}:${d.username}`).join(', ') || '—'}`);

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
