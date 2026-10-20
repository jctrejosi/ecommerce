/*
 * E2E del alcance por sucursal del picking admin.
 *  - admin de sucursal (admin.tid1, sucursal 9): /auth/me, branches, orders,
 *    metrics, shelves, users -> solo su sucursal.
 *  - admin global (temporal): ve todo.
 *  - intento de tocar un usuario de otra sucursal -> 403.
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API = 'http://localhost:3000';
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };
const GLOBAL = { username: 'zz_agent_global', email: 'zz_agent_global@dsi.test', password: 'agent1234' };
const BRANCH_ID = 9;

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

async function login(identifier, password) {
  const r = await json('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
  return r.body?.accessToken ?? null;
}

(async () => {
  const db = new Client(DB);
  await db.connect();
  // Global temporal para comprobar el "ve todo".
  await db.query(`DELETE FROM users WHERE username = $1`, [GLOBAL.username]);
  const gHash = await bcrypt.hash(GLOBAL.password, 10);
  const gIns = await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Zz','Global',true,true,false) RETURNING id`,
    [GLOBAL.email, GLOBAL.username, gHash],
  );
  const gId = Number(gIns.rows[0].id);

  try {
    const token = await login('admin.tid1', 'admin123');
    if (!token) return console.log('LOGIN admin.tid1 FALLÓ');
    console.log('LOGIN admin.tid1 ok\n');

    const me = await json('/auth/me', {}, token);
    console.log(`/auth/me -> branchId=${me.body?.branchId} branchName=${me.body?.branchName}`);

    const branches = await json('/picking-admin/branches', {}, token);
    console.log(`/picking-admin/branches -> ${JSON.stringify((branches.body ?? []).map((b) => b.id))} (esperado [${BRANCH_ID}])`);

    const orders = await json('/picking-admin/orders?branchId=10', {}, token);
    const ob = orders.body?.orders ?? orders.body ?? [];
    const obr = [...new Set(ob.map((o) => o.branchId))];
    console.log(`/picking-admin/orders?branchId=10 -> HTTP ${orders.status}, ${ob.length} pedidos, sucursales ${JSON.stringify(obr)} (forzado a ${BRANCH_ID})`);

    const metrics = await json('/picking-admin/metrics', {}, token);
    const mPickers = metrics.body ?? [];
    console.log(`/picking-admin/metrics -> ${mPickers.length} pickers: ${JSON.stringify(mPickers.map((p) => p.name))}`);

    const shelves = await json('/picking-admin/shelves?branchId=10', {}, token);
    const sb = shelves.body ?? [];
    const sbr = [...new Set(sb.map((s) => s.branchId))];
    console.log(`/picking-admin/shelves?branchId=10 -> ${sb.length} estanterías, sucursales ${JSON.stringify(sbr)} (forzado a ${BRANCH_ID})`);

    const users = await json('/picking-admin/users', {}, token);
    const ub = users.body ?? [];
    const ubr = [...new Set(ub.map((u) => u.branchId))];
    console.log(`/picking-admin/users -> ${ub.length} usuarios, sucursales ${JSON.stringify(ubr)}`);

    const chats = await json('/picking-admin/chats', {}, token);
    const cb = chats.body ?? [];
    console.log(`/picking-admin/chats -> ${cb.length} conversaciones: ${JSON.stringify(cb.map((c) => c.username))}`);

    // Tocar un usuario de OTRA sucursal (demo_picker2 #63 -> branch 10).
    const other = await db.query(`SELECT user_id FROM user_branches WHERE branch_id = 10 LIMIT 1`);
    const otherId = other.rows.length ? Number(other.rows[0].user_id) : null;
    const forbidden = await json(`/picking-admin/users/${otherId}/reset-password`, { method: 'POST', body: JSON.stringify({ password: 'x1234567' }) }, token);
    console.log(`\nreset-password a usuario #${otherId} de otra sucursal -> HTTP ${forbidden.status} (esperado 403)`);

    // Admin global temporal.
    const gToken = await login(GLOBAL.username, GLOBAL.password);
    const gBranches = await json('/picking-admin/branches', {}, gToken);
    const gOrders = await json('/picking-admin/orders', {}, gToken);
    console.log(`\n[global] branches -> ${(gBranches.body ?? []).length} (todas); orders -> ${(gOrders.body?.orders ?? gOrders.body ?? []).length} (sin filtro)`);
  } finally {
    await db.query(`DELETE FROM users WHERE id = $1`, [gId]);
    await db.end();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
