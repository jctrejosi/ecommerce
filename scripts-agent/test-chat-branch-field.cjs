/**
 * E2E: la bandeja de chat (/picking-admin/chats) debe exponer branchId/branchName
 * de cada picker, para poder filtrar por sucursal en el modal del header.
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/test-chat-branch-field.cjs
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const ADMIN = { username: 'qa-chat-branch', password: 'qa-chat-1234' };

async function main() {
  const db = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/ecommerce' });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Qa','Chat',true,true,false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  try {
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: ADMIN.username, password: ADMIN.password }),
    });
    if (!login.ok) throw new Error(`login ${login.status}: ${await login.text()}`);
    const { accessToken, user } = await login.json();
    if (user.branchId != null) throw new Error('el admin de prueba debía ser global (sin sucursal)');

    const res = await fetch(`${API}/picking-admin/chats`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`chats ${res.status}: ${await res.text()}`);
    const chats = await res.json();

    console.log(`Total conversaciones: ${chats.length}`);
    const sample = chats.slice(0, 8).map((c) => `${c.username} -> branch ${c.branchId} (${c.branchName})`);
    console.log(sample.join('\n'));

    const missing = chats.filter((c) => !('branchId' in c) || !('branchName' in c));
    console.log(missing.length === 0
      ? 'OK: todas las conversaciones traen branchId y branchName'
      : `FALLO: ${missing.length} sin campo de sucursal`);

    const byBranch = new Map();
    for (const c of chats) byBranch.set(c.branchId, (byBranch.get(c.branchId) ?? 0) + 1);
    console.log('Reparto por sucursal (branchId -> pickers):', JSON.stringify([...byBranch.entries()]));
  } finally {
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
