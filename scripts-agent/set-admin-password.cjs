/**
 * Cambia la contraseña del usuario admin y revoca sus sesiones/tokens.
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/set-admin-password.cjs
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const PASSWORD = 'admdsi4231';

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const hash = await bcrypt.hash(PASSWORD, 10);
    const r = await db.query(
      `UPDATE users
         SET password_hash = $1, locked_until = NULL, filed_attempts = 0, updated_at = now()
       WHERE username = 'admin'
       RETURNING id, username`,
      [hash],
    );
    if (r.rowCount === 0) throw new Error('El usuario "admin" no existe.');

    await db.query(`DELETE FROM user_refresh_tokens WHERE user_id = $1`, [r.rows[0].id]);
    await db.query(`DELETE FROM user_sessions WHERE user_id = $1`, [r.rows[0].id]);

    const check = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [r.rows[0].id]);
    const ok = await bcrypt.compare(PASSWORD, check.rows[0].password_hash);
    console.log(`admin (id=${r.rows[0].id}) contraseña actualizada: ${ok ? 'OK' : 'FALLA'}`);

    await db.query('COMMIT');
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
