import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const env = readFileSync(new URL('../backend/.env.development.local', import.meta.url), 'utf8');
const dbUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const b64 = env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=(.*)$/m)?.[1]?.trim();
const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
sa.private_key = sa.private_key.replace(/\\n/g, '\n');

const client = new Client({ connectionString: dbUrl });
await client.connect();
const { rows } = await client.query(
  "select id, email, push_token from customers where push_token is not null and deleted_at is null",
);
console.log('clientes con token:', rows.length);
for (const r of rows) console.log(`  #${r.id} ${r.email} (token ${String(r.push_token).length} chars)`);
await client.end();

if (!rows.length) {
  console.log('→ Aún no hay token registrado.');
  process.exit(0);
}

// Access token de Google
const assertion = jwt.sign(
  { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token' },
  sa.private_key,
  { algorithm: 'RS256', expiresIn: '1h' },
);
const tokRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
});
const tok = await tokRes.json();

for (const r of rows) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: r.push_token,
        notification: { title: 'Mercaldas 🛒', body: 'Push de prueba: si ves esto, ¡funciona!' },
        data: { type: 'TEST', linkUrl: '/account?tab=orders' },
        android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`→ push a ${r.email}:`, res.status, body?.name ?? body?.error?.status ?? '');
}
