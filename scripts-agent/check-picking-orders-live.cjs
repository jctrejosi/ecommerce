/**
 * Verifica el refresco EN VIVO de la pestaña Pedidos tras centralizar los
 * sockets (ver `ordersSocket` / `pickingSocket`): al llegar `order:updated`
 * (cambio de estado) y `picking:claim`, el panel debe volver a pedir
 * `/picking-admin/orders` sin recargar la página.
 *
 * Deja todo como estaba: el estado y el historial de los pedidos usados y los
 * usuarios temporales.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-orders-live.cjs
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
const DEBUG_PORT = 9343;
const ADMIN = { username: 'qa-orders-live', password: 'qa-orders-live-1234' };

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

  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'OrdersLive', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );
  const adminId = Number(
    (await db.query('SELECT id FROM users WHERE username = $1', [ADMIN.username]))
      .rows[0].id,
  );

  // Pedido cualquiera para el cambio de estado; y uno en cola para el claim.
  const { rows: anyOrder } = await db.query(
    'SELECT id::int AS id, reference_code, status FROM orders ORDER BY id DESC LIMIT 1',
  );
  if (!anyOrder.length) throw new Error('No hay pedidos para probar');
  const statusOrder = anyOrder[0];
  const target = statusOrder.status === 'shipped' ? 'entregado' : 'en camino';

  const { rows: queueRows } = await db.query(
    `SELECT id, reference_code, customer_id, picker_id, status, picked_at
     FROM orders WHERE picker_id IS NULL AND status = 'paid' ORDER BY id LIMIT 1`,
  );
  const claimOrder = queueRows[0] ?? null;

  const { rows: maxHist } = await db.query(
    'SELECT coalesce(max(id), 0)::bigint AS m FROM order_status_history',
  );
  const histMax = maxHist[0].m;
  const { rows: maxNotif } = await db.query(
    'SELECT coalesce(max(id), 0)::bigint AS m FROM notifications',
  );
  const notifMax = maxNotif[0].m;

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1400,1000',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-orders-live-${Date.now()}`,
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

    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('form input')`)) break;
      await sleep(250);
    }
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const [user, pass] = document.querySelectorAll('form input');
      setter.call(user, ${JSON.stringify(ADMIN.username)}); user.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pass, ${JSON.stringify(ADMIN.password)}); pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('Estanterías')`)) break;
      await sleep(250);
    }

    // Pestaña Pedidos.
    const opened = await evaluate(`(() => {
      const b = [...document.querySelectorAll('main button, nav button, button')]
        .find((x) => x.textContent.trim() === 'Pedidos');
      b?.click(); return !!b;
    })()`);
    check('se abre la pestaña Pedidos', opened);

    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('PEDIDO') || document.body.innerText.includes('No hay pedidos')`)) break;
      await sleep(250);
    }

    // Contador de peticiones a la lista de pedidos del panel.
    await evaluate(`(() => {
      window.__orders = 0;
      const original = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).includes('/picking-admin/orders')) window.__orders++;
        return original(...args);
      };
      return true;
    })()`);

    // ── Cambio de estado (order:updated) ───────────────────────────────────
    const before1 = await evaluate(`window.__orders`);
    const res = await fetch(`${BASE}/admin/orders/${statusOrder.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: target }),
    });
    check(
      `cambio de estado del pedido ${statusOrder.reference_code}`,
      res.ok,
      `HTTP ${res.status}`,
    );
    let after1 = before1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      after1 = await evaluate(`window.__orders`);
      if (after1 > before1) break;
    }
    check(
      'la pestaña Pedidos refresca al llegar order:updated',
      after1 > before1,
      `${before1} → ${after1} peticiones`,
    );

    // ── Claim (picking:claim) ──────────────────────────────────────────────
    if (claimOrder) {
      const before2 = await evaluate(`window.__orders`);
      const claimRes = await fetch(`${BASE}/picking/orders/${claimOrder.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickerId: adminId }),
      });
      check(
        `claim del pedido ${claimOrder.reference_code}`,
        claimRes.status === 201 || claimRes.status === 200,
        `HTTP ${claimRes.status}`,
      );
      let after2 = before2;
      for (let i = 0; i < 20; i++) {
        await sleep(400);
        after2 = await evaluate(`window.__orders`);
        if (after2 > before2) break;
      }
      check(
        'la pestaña Pedidos refresca al llegar picking:claim',
        after2 > before2,
        `${before2} → ${after2} peticiones`,
      );
    } else {
      console.log('\n  (sin pedido en cola: se omite la comprobación de picking:claim)');
    }
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', [
      statusOrder.status,
      statusOrder.id,
    ]);
    if (claimOrder) {
      await db.query(
        'UPDATE orders SET picker_id = $2, status = $3, picked_at = $4 WHERE id = $1',
        [claimOrder.id, claimOrder.picker_id, claimOrder.status, claimOrder.picked_at],
      );
    }
    await db.query('DELETE FROM order_status_history WHERE id > $1', [histMax.toString()]);
    if (claimOrder) {
      await db.query(
        'DELETE FROM notifications WHERE id > $1 AND target_customer_id = $2 AND message LIKE $3',
        [notifMax.toString(), claimOrder.customer_id, `%${claimOrder.reference_code}%`],
      );
    }
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
    console.log('\n  limpieza: pedidos restaurados y admin temporal eliminado');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
