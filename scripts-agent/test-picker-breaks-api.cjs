/**
 * E2E HTTP de descansos/metas:
 *  - GET/PUT /picking-admin/settings (superusuario)
 *  - GET /picking/breaks y POST /picking/breaks/use (picker)
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/test-picker-breaks-api.cjs
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const ADMIN = { username: 'qa-breaks-admin', password: 'qa-breaks-1234' };
const PICKER = { username: 'qa-breaks-pick', password: 'qa-breaks-5678' };
const KEY = 'picking_break_policy';

async function login(identifier, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`login ${identifier} ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const auth = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

async function main() {
  const db = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/ecommerce' });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = ANY($1)', [[ADMIN.username, PICKER.username]]);
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  const pickerHash = await bcrypt.hash(PICKER.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Qa','BreaksAdmin',true,true,false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, adminHash],
  );
  const [picker] = (
    await db.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
       VALUES ($1,$2,$3,'Qa','BreaksPick',false,true,true) RETURNING id`,
      [`${PICKER.username}@qa.local`, PICKER.username, pickerHash],
    )
  ).rows;

  const prev = (await db.query('SELECT value FROM settings WHERE key = $1', [KEY])).rows[0];

  const ok = (cond, label, extra) => {
    console.log(`${cond ? 'OK ' : 'FALLO'} · ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
    if (!cond) process.exitCode = 1;
  };

  try {
    const admin = await login(ADMIN.username, ADMIN.password);
    const pickerLogin = await login(PICKER.username, PICKER.password);

    const get1 = await fetch(`${API}/picking-admin/settings`, { headers: auth(admin.accessToken) });
    const s1 = await get1.json();
    ok(get1.ok && typeof s1.productsPerBreak === 'number', 'GET settings (admin)', s1);

    const put = await fetch(`${API}/picking-admin/settings`, {
      method: 'PUT',
      headers: auth(admin.accessToken),
      body: JSON.stringify({
        productsPerBreak: 4,
        breakMinutes: 6,
        dailyProductGoal: 50,
        dailyBonusAmount: 15000,
        bankExpiryDays: 7,
      }),
    });
    const s2 = await put.json();
    ok(put.ok && s2.productsPerBreak === 4 && s2.breakMinutes === 6 && s2.dailyBonusAmount === 15000,
      'PUT settings (admin)', s2);

    const b1 = await fetch(`${API}/picking/breaks`, { headers: auth(pickerLogin.accessToken) });
    const sum1 = await b1.json();
    ok(b1.ok && sum1.bankMinutes === 0 && sum1.goal.target === 50, 'GET breaks (picker)', {
      bankMinutes: sum1.bankMinutes,
      goal: sum1.goal?.target,
    });

    // Simula un descanso ganado y verifica el banco y el reclamo.
    await db.query(
      `INSERT INTO picker_break_ledger (user_id, branch_id, day, type, minutes, threshold_index, note)
       VALUES ($1, 9, CURRENT_DATE, 'earned', 12, 1, 'qa')`,
      [picker.id],
    );
    const b2 = await fetch(`${API}/picking/breaks`, { headers: auth(pickerLogin.accessToken) });
    const sum2 = await b2.json();
    ok(b2.ok && sum2.bankMinutes === 12, 'banco refleja 12 min', { bankMinutes: sum2.bankMinutes });

    const use = await fetch(`${API}/picking/breaks/use`, {
      method: 'POST',
      headers: auth(pickerLogin.accessToken),
      body: JSON.stringify({ minutes: 5 }),
    });
    const used = await use.json();
    ok(use.ok && used.bankMinutes === 7, 'reclama 5 min -> banco 7', { bankMinutes: used.bankMinutes });

    const bad = await fetch(`${API}/picking/breaks/use`, {
      method: 'POST',
      headers: auth(pickerLogin.accessToken),
      body: JSON.stringify({ minutes: 999 }),
    });
    ok(bad.status === 400, 'reclamo mayor al banco -> 400', { status: bad.status });

    // El picker no puede tocar la configuración (requiere superusuario).
    const forbidden = await fetch(`${API}/picking-admin/settings`, {
      headers: auth(pickerLogin.accessToken),
    });
    ok(forbidden.status === 403, 'picker no accede a settings (403)', { status: forbidden.status });
  } finally {
    await db.query('DELETE FROM picker_break_ledger WHERE user_id = $1', [picker.id]);
    await db.query('DELETE FROM picker_daily_stats WHERE user_id = $1', [picker.id]);
    await db.query('DELETE FROM users WHERE username = ANY($1)', [[ADMIN.username, PICKER.username]]);
    if (prev) {
      await db.query('UPDATE settings SET value = $1 WHERE key = $2', [prev.value, KEY]);
    } else {
      await db.query('DELETE FROM settings WHERE key = $1', [KEY]);
    }
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
