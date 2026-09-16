/**
 * Crea (o recrea) un usuario temporal de QA para poder entrar al panel de
 * delivery desde un navegador headless y verificar el mapa.
 * Borrar con `node scripts-agent/delete-qa-admin.cjs` al terminar.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const from = (mod, ...dirs) =>
  require(require.resolve(mod, { paths: dirs.map((d) => path.join(ROOT, d)) }));

const { Client } = from('pg', 'backend/node_modules');
const bcrypt = from('bcryptjs', 'backend/node_modules');

const USERNAME = 'qa-delivery-temp';
const PASSWORD = 'demo123';
const DB =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

(async () => {
  const db = new Client(DB);
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [USERNAME]);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'QA', 'Delivery', true, true, now(), now())
     RETURNING id`,
    [`${USERNAME}@dsi.test`, USERNAME, hash],
  );
  console.log(`usuario temporal creado: ${USERNAME} / ${PASSWORD} (id ${rows[0].id})`);
  await db.end();
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
