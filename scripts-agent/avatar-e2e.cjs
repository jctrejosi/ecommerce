/**
 * Prueba end-to-end de la foto de perfil del repartidor.
 *
 *   1. Login del repartidor (juan).
 *   2. POST multipart a `/delivery/profile/avatar` con una imagen de prueba.
 *   3. Verifica que Cloudinary devolvió URL y que quedó en la BD
 *      (`delivery_drivers.avatar_url`).
 *   4. Limpia: deja `avatar_url` en NULL otra vez.
 *
 * Uso: BASE_URL=http://localhost:3100 node scripts-agent/avatar-e2e.cjs
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { Client } = require(
  require.resolve('pg', { paths: [path.join(ROOT, 'backend/node_modules')] }),
);

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

// PNG 1x1 válido (suficiente para probar el pipeline de subida).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAI/wHnAQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  const loginRes = await fetch(`${BASE}/delivery/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'juan', password: 'juan4231' }),
  });
  const login = await loginRes.json();
  if (!login.accessToken) throw new Error(`Login HTTP ${loginRes.status}: ${JSON.stringify(login)}`);

  const form = new FormData();
  form.append('file', new Blob([PNG_1x1], { type: 'image/png' }), 'avatar-test.png');

  const res = await fetch(`${BASE}/delivery/profile/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.accessToken}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  const avatarUrl = body?.avatarUrl ?? body?.data?.avatarUrl ?? null;
  console.log(`[api] POST /delivery/profile/avatar -> HTTP ${res.status}`);
  console.log(`[api] avatarUrl: ${avatarUrl ?? JSON.stringify(body).slice(0, 200)}`);

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const row = (await db.query('SELECT avatar_url FROM delivery_drivers WHERE id = 6')).rows[0];
  console.log(`[db] delivery_drivers.avatar_url: ${row?.avatar_url ?? 'NULL'}`);

  const ok = res.status < 400 && Boolean(avatarUrl) && row?.avatar_url === avatarUrl;
  if (ok) {
    await db.query('UPDATE delivery_drivers SET avatar_url = NULL WHERE id = 6');
    console.log('[cleanup] avatar_url vuelto a NULL');
  }
  await db.end();
  console.log(ok ? 'RESULTADO: OK' : 'RESULTADO: FALLO');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
