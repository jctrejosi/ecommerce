/*
 * Prueba E2E del cableado picker -> sucursal (una sola).
 * Crea un superusuario temporal para autenticar, prueba listar/asignar/reasignar
 * y luego lo elimina. Restaura el picker de prueba a su sucursal original.
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API = 'http://localhost:3000';
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };
const TEMP = { username: 'zz_agent_branch', email: 'zz_agent_branch@dsi.test', password: 'agent1234' };

async function json(path, opts = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

(async () => {
  const db = new Client(DB);
  await db.connect();

  await db.query(`DELETE FROM users WHERE username = $1`, [TEMP.username]);
  const hash = await bcrypt.hash(TEMP.password, 10);
  const ins = await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Zz','Agent',true,true,false) RETURNING id`,
    [TEMP.email, TEMP.username, hash],
  );
  const tempId = ins.rows[0].id;
  console.log(`Superusuario temporal creado #${tempId}`);

  try {
    const login = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: TEMP.username, password: TEMP.password }),
    });
    const token = login.body?.accessToken;
    if (login.status >= 300 || !token) {
      console.log('LOGIN FALLÓ:', login.status, JSON.stringify(login.body));
      return;
    }
    console.log(`LOGIN ok (${TEMP.username})`);

    const branches = (await json('/picking-admin/branches', {}, token)).body ?? [];
    const [b1, b2] = branches;
    console.log(`Sucursales: ${branches.length}`);
    if (!b1 || !b2) return console.log('Faltan sucursales');

    const usersRes = await json('/picking-admin/users', {}, token);
    console.log(`HTTP GET /picking-admin/users: ${usersRes.status}`);
    const pickers = (usersRes.body ?? []).filter((u) => u.isPicker);
    console.log('Pickers y sucursal:');
    for (const u of pickers) {
      console.log(`  #${u.id} ${u.username.padEnd(18)} branchId=${u.branchId} branchName=${u.branchName}`);
    }

    const target = pickers.find((u) => u.username === 'demo_picker4') ?? pickers[0];
    const original = target.branchId;
    console.log(`\nObjetivo #${target.id} ${target.username} (original=${original})`);

    const set1 = await json(`/picking-admin/users/${target.id}`, { method: 'PUT', body: JSON.stringify({ branchId: b1.id }) }, token);
    console.log(`PUT branch=${b1.name}: HTTP ${set1.status} -> branchId=${set1.body?.branchId} (${set1.body?.branchName})`);

    const set2 = await json(`/picking-admin/users/${target.id}`, { method: 'PUT', body: JSON.stringify({ branchId: b2.id }) }, token);
    console.log(`PUT branch=${b2.name}: HTTP ${set2.status} -> branchId=${set2.body?.branchId} (${set2.body?.branchName})`);

    const rows = await db.query(`SELECT branch_id FROM user_branches WHERE user_id = $1`, [target.id]);
    console.log(`Filas en user_branches para el picker: ${rows.rowCount} (debe ser 1 → única sucursal ✔)`);

    const restore = await json(`/picking-admin/users/${target.id}`, { method: 'PUT', body: JSON.stringify({ branchId: original }) }, token);
    console.log(`RESTAURADO: HTTP ${restore.status} -> branchId=${restore.body?.branchId} (${restore.body?.branchName})`);
  } finally {
    await db.query(`DELETE FROM users WHERE id = $1`, [tempId]);
    const left = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE username = $1`, [TEMP.username]);
    console.log(`\nSuperusuario temporal eliminado (quedan ${left.rows[0].n}).`);
    await db.end();
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
