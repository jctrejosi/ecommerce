/**
 * Verifica que `GET /picking-admin/branches` (filtro de sucursales del panel)
 * devuelva SOLO las sucursales activas.
 *
 * Usa un administrador temporal y lo borra al terminar.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-branches.cjs
 */
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const ADMIN_USER = 'qa-branches-admin';
const ADMIN_PASS = 'qa-branches-1234';

let ok = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    ok++;
    console.log(`  ok   ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  FALLA ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function main() {
  const env = readFileSync(
    resolve(__dirname, '../backend/.env.development.local'),
    'utf8',
  );
  const dbUrl = env
    .match(/^DATABASE_URL=(.*)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  await db.query('DELETE FROM users WHERE username = $1', [ADMIN_USER]);
  const hash = await bcrypt.hash(ADMIN_PASS, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'QA', 'Branches', true, true, true)`,
    [`${ADMIN_USER}@qa.local`, ADMIN_USER, hash],
  );

  try {
    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: ADMIN_USER, password: ADMIN_PASS }),
    });
    const tokens = await login.json();
    check('login del admin temporal', login.status === 200, `HTTP ${login.status}`);

    const res = await fetch(`${BASE}/picking-admin/branches`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const branches = await res.json();
    check('la petición responde 200', res.status === 200, `HTTP ${res.status}`);

    const { rows: activeRows } = await db.query(
      'SELECT id, name FROM branches WHERE is_active = true AND deleted_at IS NULL ORDER BY id',
    );
    const { rows: inactiveRows } = await db.query(
      'SELECT id, name FROM branches WHERE is_active = false AND deleted_at IS NULL ORDER BY id',
    );
    const returnedIds = new Set((branches ?? []).map((b) => Number(b.id)));
    const inactiveIds = inactiveRows.map((b) => Number(b.id));

    check(
      'devuelve exactamente las sucursales activas',
      returnedIds.size === activeRows.length &&
        activeRows.every((b) => returnedIds.has(Number(b.id))),
      `${returnedIds.size} vs ${activeRows.length} activas`,
    );
    check(
      'no devuelve ninguna sucursal inactiva',
      inactiveIds.every((id) => !returnedIds.has(id)),
      `inactivas: ${inactiveIds.join(', ')}`,
    );

    console.log(
      `  devueltas: ${(branches ?? []).map((b) => `${b.name}#${b.id}`).join(', ')}`,
    );
  } finally {
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN_USER]);
    await db.end();
    console.log('\n  limpieza: admin temporal eliminado');
  }

  console.log(`\n== Resultado: ${ok}/${ok + fail} verificaciones ok ==`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
