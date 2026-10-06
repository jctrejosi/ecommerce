/*
 * E2E: el tab de usuarios filtra por la sucursal seleccionada (?branchId=).
 *  - admin global: users?branchId=9 -> solo sucursal 9; sin param -> todos.
 *  - admin de sucursal (admin.tid1, sucursal 9): ?branchId=10 -> sigue 9 (forzado).
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API = 'http://localhost:3000';
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };
const GLOBAL = { username: 'zz_agent_users', email: 'zz_agent_users@dsi.test', password: 'agent1234' };

async function json(path, opts = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const login = async (identifier, password) =>
  (await json('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) })).body?.accessToken;

(async () => {
  const db = new Client(DB);
  await db.connect();
  await db.query(`DELETE FROM users WHERE username = $1`, [GLOBAL.username]);
  const hash = await bcrypt.hash(GLOBAL.password, 10);
  const ins = await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Zz','Users',true,true,false) RETURNING id`,
    [GLOBAL.email, GLOBAL.username, hash],
  );
  const gId = Number(ins.rows[0].id);

  try {
    const gToken = await login(GLOBAL.username, GLOBAL.password);
    const show = (label, body) => {
      const list = body ?? [];
      const byBranch = {};
      for (const u of list) byBranch[u.branchId ?? 'sin-sucursal'] = (byBranch[u.branchId ?? 'sin-sucursal'] ?? 0) + 1;
      console.log(`${label}: ${list.length} usuarios -> ${JSON.stringify(byBranch)}`);
    };

    show('[global] users (sin filtro)', (await json('/picking-admin/users', {}, gToken)).body);
    show('[global] users?branchId=9 ', (await json('/picking-admin/users?branchId=9', {}, gToken)).body);
    show('[global] users?branchId=10', (await json('/picking-admin/users?branchId=10', {}, gToken)).body);

    const tToken = await login('admin.tid1', 'admin123');
    show('[tid1]   users?branchId=10', (await json('/picking-admin/users?branchId=10', {}, tToken)).body);
  } finally {
    await db.query(`DELETE FROM users WHERE id = $1`, [gId]);
    await db.end();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
