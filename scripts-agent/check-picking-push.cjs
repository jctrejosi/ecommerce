/**
 * Verifica el push del picking de punta a punta:
 *   1. el picker tiene token FCM registrado en `users.push_token`,
 *   2. un mensaje del administrador dispara el push (FCM) al dispositivo,
 *   3. el dispositivo lo recibe (se revisa por adb).
 *
 * Usa un administrador temporal (`qa-push-admin`) para no tocar cuentas reales y
 * borra todo lo que crea.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-push.cjs
 */
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const ADB = '/home/jk/Android/Sdk/platform-tools/adb';
const ADMIN_USER = 'qa-push-admin';
const ADMIN_PASS = 'qa-push-1234';
const PICKER_USERNAME = 'juan';

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

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no JSON */
  }
  return { status: res.status, json, text };
}

function adbNotifications() {
  try {
    const out = execFileSync(
      ADB,
      ['shell', 'dumpsys', 'notification', '--noredact'],
      { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 },
    );
    return out;
  } catch (err) {
    return `(adb falló: ${err.message})`;
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

  // Limpieza por si una corrida anterior quedó a medias.
  await db.query('DELETE FROM picker_chat_messages WHERE body LIKE $1', [
    '%[qa-push]%',
  ]);
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN_USER]);

  const { rows: pickerRows } = await db.query(
    'SELECT id, username, push_token FROM users WHERE username = $1 AND deleted_at IS NULL',
    [PICKER_USERNAME],
  );
  if (!pickerRows.length) {
    console.error(`No existe el picker ${PICKER_USERNAME}`);
    process.exit(1);
  }
  const picker = pickerRows[0];
  console.log(`picker ${picker.username} (id ${picker.id})`);

  console.log('\n== Token FCM registrado por la app ==');
  check(
    'el picker tiene push_token en la BD',
    typeof picker.push_token === 'string' && picker.push_token.length > 50,
    picker.push_token ? `${picker.push_token.slice(0, 18)}…` : 'null',
  );

  // Administrador temporal para poder usar el panel.
  const hash = await bcrypt.hash(ADMIN_PASS, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'QA', 'Push', true, true, true)`,
    [`${ADMIN_USER}@qa.local`, ADMIN_USER, hash],
  );
  const login = await api('/auth/login', {
    method: 'POST',
    body: { identifier: ADMIN_USER, password: ADMIN_PASS },
  });
  check('login del admin temporal', login.status === 200, `HTTP ${login.status}`);
  const adminToken = login.json?.accessToken;
  if (!adminToken) {
    console.error(login.text);
    process.exit(1);
  }

  console.log('\n== Mensaje del admin -> push al dispositivo ==');
  const before = adbNotifications();
  const msg = await api(`/picking-admin/pickers/${picker.id}/messages`, {
    method: 'POST',
    token: adminToken,
    body: { body: '[qa-push] Prueba de notificación automática.' },
  });
  check('el mensaje del admin se crea', msg.status === 201, `HTTP ${msg.status}`);

  // Margen para que FCM entregue.
  await new Promise((r) => setTimeout(r, 9000));
  const after = adbNotifications();

  const hasPicking = /com\.dsi\.pickingapp/.test(after);
  check('el dispositivo registra una notificación del picking', hasPicking);

  // Se muestran las líneas del canal de avisos, para dejar evidencia.
  const lines = after
    .split('\n')
    .filter((l) => /picking-alerts|dsi-picking|Mensaje de administración/.test(l))
    .map((l) => l.trim());
  console.log('  evidencia del dispositivo:');
  if (lines.length) for (const l of lines.slice(0, 8)) console.log(`    ${l}`);
  else console.log('    (sin líneas del canal en el volcado)');

  console.log('\n== Limpieza ==');
  const del = await db.query('DELETE FROM picker_chat_messages WHERE body = $1', [
    '[qa-push] Prueba de notificación automática.',
  ]);
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN_USER]);
  console.log(`  mensajes borrados: ${del.rowCount}, admin temporal eliminado`);

  await db.end();
  console.log(`\n== Resultado: ${ok}/${ok + fail} verificaciones ok ==`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
