/**
 * Migra el rol combinado obsoleto "Picking y Delivery" al diseño nuevo:
 * roles separados por aplicativo ("Picking" y "Delivery", de sistema).
 *
 * - Asigna a los usuarios que tengan "Picking y Delivery" los roles de sistema
 *   "Picking" y "Delivery" (idempotente).
 * - Elimina el rol personalizado "Picking y Delivery" y sus asignaciones/permisos.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/migrate-picking-delivery-role.cjs          # dry-run
 *   APPLY=1 NODE_PATH=backend/node_modules node scripts-agent/migrate-picking-delivery-role.cjs  # aplica
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const APPLY = process.env.APPLY === '1';
const OLD_ROLE = 'Picking y Delivery';
const NEW_ROLES = ['Picking', 'Delivery'];

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');

    const old = await db.query(`SELECT id, is_system FROM roles WHERE name = $1`, [OLD_ROLE]);
    if (old.rowCount === 0) {
      console.log(`No existe el rol "${OLD_ROLE}". Nada que migrar.`);
      await db.query('ROLLBACK');
      return;
    }
    const oldId = Number(old.rows[0].id);

    const news = await db.query(
      `SELECT id, name FROM roles WHERE name = ANY($1::text[]) ORDER BY name`,
      [NEW_ROLES],
    );
    if (news.rowCount !== NEW_ROLES.length) {
      throw new Error(
        `Faltan roles de sistema. Esperados ${NEW_ROLES.join(', ')}, encontrados ${news.rows
          .map((r) => r.name)
          .join(', ')}.`,
      );
    }

    const affected = await db.query(
      `SELECT u.id, u.username FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role_id = $1 ORDER BY u.id`,
      [oldId],
    );
    console.log(`Rol "${OLD_ROLE}" (#${oldId}) asignado a ${affected.rowCount} usuario(s):`);
    for (const u of affected.rows) console.log(`  #${u.id} ${u.username}`);

    for (const u of affected.rows) {
      for (const nr of news.rows) {
        await db.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [u.id, nr.id],
        );
      }
    }
    console.log(`Asignados roles [${news.rows.map((r) => r.name).join(', ')}] a esos usuarios.`);

    await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [oldId]);
    await db.query(`DELETE FROM user_roles WHERE role_id = $1`, [oldId]);
    await db.query(`DELETE FROM roles WHERE id = $1`, [oldId]);
    console.log(`Eliminado rol obsoleto "${OLD_ROLE}".`);

    // ── VALIDACIÓN ─────────────────────────────────────────────────────────
    console.log('\n===== VALIDACIÓN =====');
    const userRoles = await db.query(
      `SELECT u.username, array_agg(r.name ORDER BY r.name) AS roles
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       JOIN roles r ON r.id = ur.role_id
       GROUP BY u.username
       ORDER BY u.username`,
    );
    console.log('Roles por usuario:');
    for (const ur of userRoles.rows) {
      console.log(`  ${ur.username} → ${ur.roles.join(', ')}`);
    }

    const remaining = await db.query(`SELECT count(*)::int AS n FROM roles WHERE name = $1`, [OLD_ROLE]);
    console.log(`Roles con nombre "${OLD_ROLE}" restantes: ${remaining.rows[0].n}`);

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
