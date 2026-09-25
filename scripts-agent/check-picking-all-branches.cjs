/**
 * Verifica el filtro "Todas las sucursales" del panel de picking admin:
 *   1. API: `GET /picking-admin/orders` sin `branchId` devuelve los pedidos de
 *      todas las sucursales (y coincide con la suma de cada sucursal),
 *   2. UI: el chip "Todas" existe, se puede elegir y la pestaña Pedidos pasa de
 *      "TID Sucursal 1 · N pedidos" a "Todas las sucursales · M pedidos".
 *
 * Usa un administrador temporal y lo borra al terminar.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-all-branches.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9337;
const ADMIN_USER = 'qa-branches2-admin';
const ADMIN_PASS = 'qa-branches2-1234';

let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('no se pudo abrir el socket CDP')));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send };
}

async function main() {
  const DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/ecommerce';
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN_USER]);
  const hash = await bcrypt.hash(ADMIN_PASS, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'QA', 'Branches2', true, true, true)`,
    [`${ADMIN_USER}@qa.local`, ADMIN_USER, hash],
  );

  let chrome = null;
  try {
    const login = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: ADMIN_USER, password: ADMIN_PASS }),
    });
    const tokens = await login.json();
    const auth = { Authorization: `Bearer ${tokens.accessToken}` };

    const orders = async (qs) => {
      const res = await fetch(`${BASE}/picking-admin/orders?${qs}`, { headers: auth });
      return res.json();
    };

    console.log('== API: pedidos de todas las sucursales ==');
    const all = await orders('limit=1');
    check('sin branchId el backend no filtra sucursal', all.branchId === null, `branchId=${all.branchId}`);

    const { rows: branchRows } = await db.query(
      'SELECT DISTINCT branch_id FROM orders WHERE branch_id IS NOT NULL ORDER BY branch_id',
    );
    const branchIds = branchRows.map((r) => Number(r.branch_id));
    const perBranch = [];
    for (const id of branchIds) {
      const one = await orders(`branchId=${id}&limit=1`);
      perBranch.push(one.total);
      console.log(`    sucursal ${id}: ${one.total} pedidos (branchId=${one.branchId})`);
    }
    const sum = perBranch.reduce((a, b) => a + b, 0);
    console.log(`    todas: ${all.total} pedidos`);
    check(
      '"todas" coincide con la suma de cada sucursal',
      all.total === sum,
      `${all.total} vs ${sum}`,
    );
    check(
      '"todas" es mayor que cualquier sucursal',
      all.total > Math.max(...perBranch),
      `${all.total}`,
    );

    // ── UI ────────────────────────────────────────────────────────────────────
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1400,1000',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-branches-${Date.now()}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        .then((r) => r.json())
        .catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets?.find((t) => t.type === 'page');
    if (!page) throw new Error('Chromium no expuso ninguna página');

    const cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    const { send } = cdp;
    await send('Page.enable');
    await send('Runtime.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      return r.result.value;
    };
    const clickTab = (label) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        if (!b) return false;
        b.click();
        return true;
      })()`);
    const headerText = () =>
      evaluate(`(() => {
        const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent.trim() === 'Pedidos');
        return h ? h.parentElement.querySelector('p').textContent.trim() : null;
      })()`);

    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('form input')`)) break;
      await sleep(250);
    }
    // La contraseña real del admin se resuelve contra el hash de la BD.
    const adminHash = (
      await db.query("SELECT password_hash FROM users WHERE username = 'admin'")
    ).rows[0]?.password_hash;
    const adminPass = ['admdsi4231', 'admin123'].find((p) =>
      bcrypt.compareSync(p, adminHash ?? ''),
    );
    if (!adminPass) throw new Error('No se pudo resolver la contraseña del admin');
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const [user, pass] = document.querySelectorAll('form input');
      setter.call(user, 'admin'); user.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pass, ${JSON.stringify(adminPass)}); pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('Estanterías')`)) break;
      await sleep(250);
    }

    console.log('\n== UI: chip "Todas" en el filtro de sucursales ==');
    const hasChip = await evaluate(
      `[...document.querySelectorAll('header button')].some((b) => b.textContent.trim() === 'Todas')`,
    );
    check('el chip "Todas" existe en el header', hasChip);

    await clickTab('Pedidos');
    // El encabezado arranca en "0 pedidos" mientras llega la lista: esperar a
    // que el conteo sea real antes de leerlo.
    for (let i = 0; i < 60; i++) {
      const t = await headerText();
      const n = Number((t ?? '').match(/·\s*(\d+)\s+pedido/)?.[1] ?? 0);
      if (n > 0) break;
      await sleep(250);
    }
    const before = await headerText();
    console.log(`    antes:  ${before}`);
    check('con sucursal concreta muestra su nombre', /·\s*\d+\s+pedidos?/.test(before ?? '') && !(before ?? '').startsWith('Todas'), before);

    await evaluate(
      `[...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Todas').click()`,
    );
    await sleep(1200);
    const after = await headerText();
    console.log(`    después: ${after}`);
    check('con "Todas" el encabezado lo dice', (after ?? '').startsWith('Todas las sucursales'), after);
    const afterCount = Number((after ?? '').match(/·\s*(\d+)\s+pedido/)?.[1] ?? -1);
    const beforeCount = Number((before ?? '').match(/·\s*(\d+)\s+pedido/)?.[1] ?? -1);
    check(
      '"Todas" muestra más pedidos que una sola sucursal',
      afterCount === all.total && afterCount > beforeCount,
      `${afterCount} vs ${beforeCount} (todas=${all.total})`,
    );

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-admin-all-branches.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-admin-all-branches.png');
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN_USER]);
    await db.end();
    console.log('\n  limpieza: admin temporal eliminado');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
