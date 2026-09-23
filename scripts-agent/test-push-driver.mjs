/**
 * Manda un push de prueba (FCM HTTP v1) a los REPARTIDORES con token registrado.
 * Sirve para validar el canal `delivery` de la app `com.dsi.deliveryapp` sin
 * tener que provocar un pedido real.
 *
 * Uso: node scripts-agent/test-push-driver.mjs [id-repartidor]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const env = readFileSync(new URL('../backend/.env.development.local', import.meta.url), 'utf8');
const dbUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const rawSa = env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const sa = JSON.parse(rawSa.startsWith('{') ? rawSa : Buffer.from(rawSa, 'base64').toString('utf8'));
sa.private_key = sa.private_key.replace(/\\n/g, '\n');

const onlyId = process.argv[2] ? Number(process.argv[2]) : null;

const client = new Client({ connectionString: dbUrl });
await client.connect();
const { rows } = await client.query(
  `select id, full_name, push_token
     from delivery_drivers
    where push_token is not null and deleted_at is null
      and ($1::bigint is null or id = $1::bigint)
    order by id`,
  [onlyId],
);
console.log('repartidores con token:', rows.length);
for (const r of rows) console.log(`  #${r.id} ${r.full_name} (token ${String(r.push_token).length} chars)`);
await client.end();

if (!rows.length) {
  console.log('→ Aún no hay token registrado. Abre la app en el celular e inicia sesión.');
  process.exit(0);
}

const assertion = jwt.sign(
  {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
  },
  sa.private_key,
  { algorithm: 'RS256', expiresIn: '1h' },
);
const tokRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
});
const tok = await tokRes.json();
if (!tok.access_token) {
  console.error('no se pudo obtener access token:', tok.error_description ?? tok.error);
  process.exit(1);
}

for (const r of rows) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: r.push_token,
        notification: { title: 'Delivery 🛵', body: 'Push de prueba: si ves esto, ¡funciona!' },
        data: { type: 'TEST' },
        android: { priority: 'high', notification: { channelId: 'delivery', sound: 'default' } },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`→ push a ${r.full_name}:`, res.status, body?.name ?? body?.error?.status ?? '');
}
