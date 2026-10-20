/*
 * E2E: la cola del picking se filtra por la sucursal del picker autenticado.
 *  - crea un picker temporal con sucursal,
 *  - llama GET /picking/orders con token -> solo pedidos de su sucursal,
 *  - llama sin token -> sin filtro (todos),
 *  - verifica unreviewed-count,
 *  - limpia el usuario temporal.
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API = 'http://localhost:3000';
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };
const TEMP = { username: 'zz_agent_branchpick', email: 'zz_agent_branchpick@dsi.test', password: 'agent1234' };
const BRANCH_ID = 9; // TID Sucursal 1

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

(async () => {
  const db = new Client(DB);
  await db.connect();
  await db.query(`DELETE FROM users WHERE username = $1`, [TEMP.username]);
  const hash = await bcrypt.hash(TEMP.password, 10);
  const ins = await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Zz','Pick',false,true,true) RETURNING id`,
    [TEMP.email, TEMP.username, hash],
  );
  const uid = Number(ins.rows[0].id);
  await db.query(`INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2)`, [uid, BRANCH_ID]);
  console.log(`Picker temporal #${uid} con sucursal ${BRANCH_ID}`);

  try {
    const login = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: TEMP.username, password: TEMP.password }),
    });
    const token = login.body?.accessToken;
    if (!token) return console.log('LOGIN FALLÓ:', login.status, JSON.stringify(login.body));
    console.log('LOGIN ok');

    const expected = await db.query(
      `SELECT COUNT(*)::int AS n FROM orders
        WHERE status IN ('created','payment_pending','paid','preparing','ready','shipped','delivered')
          AND branch_id = $1`,
      [BRANCH_ID],
    );

    const withToken = await json('/picking/orders', {}, token);
    const orders = withToken.body ?? [];
    const branches = [...new Set(orders.map((o) => o.branchId))];
    console.log(`\nCon token: HTTP ${withToken.status}, ${orders.length} pedidos`);
    console.log(`  sucursales presentes: ${JSON.stringify(branches)} (esperado solo ${BRANCH_ID})`);
    console.log(`  conteo esperado en BD (sucursal ${BRANCH_ID}, todos los estados de cola): ${expected.rows[0].n}`);

    const noToken = await json('/picking/orders', {});
    console.log(`\nSin token: HTTP ${noToken.status}, ${(noToken.body ?? []).length} pedidos (sin filtro)`);

    const cnt = await json('/picking/orders/unreviewed-count', {}, token);
    const cntAll = await json('/picking/orders/unreviewed-count', {});
    console.log(`\nunreviewed-count con token: ${JSON.stringify(cnt.body)} | sin token: ${JSON.stringify(cntAll.body)}`);

    const okBranch = branches.every((b) => b === BRANCH_ID);
    console.log(`\nVerificación: ${okBranch ? '✔ solo la sucursal del picker' : '✘ aparecieron otras sucursales'}`);
  } finally {
    await db.query(`DELETE FROM users WHERE id = $1`, [uid]);
    const left = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE username = $1`, [TEMP.username]);
    console.log(`Usuario temporal eliminado (quedan ${left.rows[0].n}).`);
    await db.end();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
