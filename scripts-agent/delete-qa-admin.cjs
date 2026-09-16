/** Borra el usuario temporal de QA creado por create-qa-admin.cjs. */
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
  const { rowCount } = await db.query(
    'DELETE FROM users WHERE username = $1',
    ['qa-delivery-temp'],
  );
  console.log(`usuarios temporales borrados: ${rowCount}`);
  await db.end();
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
