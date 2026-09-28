/**
 * Verifica el refresco EN VIVO de la pestaña Pickers tras mover el socket al
 * módulo compartido (`pickingSocket`): al llegar `picking:claim` el panel debe
 * volver a pedir `/picking-admin/metrics` sin recargar la página.
 *
 * Usa un pedido en cola sin cliente (para no generar notificaciones) y lo deja
 * exactamente como estaba: picker, estado, marca de toma y su historial.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-live.cjs
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
const DEBUG_PORT = 9339;
const PICKER = { username: 'qa-live-picker', password: 'qa-live-1234' };
const ADMIN = { username: 'qa-live-admin', password: 'qa-live-5678' };

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

  // Pedido en cola para reclamarlo y deshacerlo sin rastro.
  const { rows: orderRows } = await db.query(
    `SELECT id, reference_code, customer_id, picker_id, status, picked_at
     FROM orders
     WHERE picker_id IS NULL AND status = 'paid'
     ORDER BY id LIMIT 1`,
  );
  if (!orderRows.length) {
    console.error('No hay pedidos en cola para la prueba.');
    process.exit(1);
  }
  const order = orderRows[0];
  const { rows: maxHist } = await db.query(
    'SELECT coalesce(max(id), 0)::int AS max FROM order_status_history',
  );
  const histMax = Number(maxHist[0].max);
  const { rows: maxNotif } = await db.query(
    'SELECT coalesce(max(id), 0)::bigint AS max FROM notifications',
  );
  const notifMax = maxNotif[0].max;

  const cleanup = async () => {
    // El pedido vuelve a como estaba y se borra el rastro que dejó la prueba
    // (historial de estado y la notificación al cliente del pedido).
    await db.query(
      'UPDATE orders SET picker_id = $2, status = $3, picked_at = $4 WHERE id = $1',
      [order.id, order.picker_id, order.status, order.picked_at],
    );
    await db.query('DELETE FROM order_status_history WHERE id > $1', [histMax]);
    await db.query(
      'DELETE FROM notifications WHERE id > $1 AND target_customer_id = $2 AND message LIKE $3',
      [notifMax, order.customer_id, `%${order.reference_code}%`],
    );
    await db.query('DELETE FROM users WHERE username = ANY($1)', [
      [PICKER.username, ADMIN.username],
    ]);
  };
  await db.query('DELETE FROM users WHERE username = ANY($1)', [
    [PICKER.username, ADMIN.username],
  ]);

  const hash = await bcrypt.hash(PICKER.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'LivePicker', false, true, true)`,
    [`${PICKER.username}@qa.local`, PICKER.username, hash],
  );
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'LiveAdmin', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, adminHash],
  );
  const pickerId = Number(
    (
      await db.query('SELECT id FROM users WHERE username = $1', [
        PICKER.username,
      ])
    ).rows[0].id,
  );

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
        `--user-data-dir=/tmp/cdp-live-${Date.now()}`,
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

    // Pestaña Pickers (la que escucha los eventos en vivo).
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Pickers');
      b?.click(); return !!b;
    })()`);
    for (let i = 0; i < 60; i++) {
      const done = await evaluate(
        `document.body.innerText.includes('conectado (tiempo real)') && !document.body.innerText.includes('Actualizando…')`,
      );
      if (done) break;
      await sleep(300);
    }
    const connected = await evaluate(
      `document.body.innerText.includes('conectado (tiempo real)')`,
    );
    check('el panel está conectado en vivo', connected);

    // Contador de peticiones a las métricas.
    await evaluate(`(() => {
      window.__metrics = 0;
      const original = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).includes('/picking-admin/metrics')) window.__metrics++;
        return original(...args);
      };
      return true;
    })()`);
    const before = await evaluate(`window.__metrics`);

    console.log(`\n== picking:claim refresca la pestaña (pedido ${order.id}) ==`);
    const res = await fetch(`${BASE}/picking/orders/${order.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickerId }),
    });
    check('el pedido se reclama', res.status === 201 || res.status === 200, `HTTP ${res.status}`);

    let after = before;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      after = await evaluate(`window.__metrics`);
      if (after > before) break;
    }
    check(
      'el panel vuelve a pedir las métricas al llegar el evento',
      after > before,
      `${before} → ${after} peticiones`,
    );
  } finally {
    chrome?.kill('SIGKILL');
    await cleanup();
    const { rows: restored } = await db.query(
      'SELECT picker_id, status FROM orders WHERE id = $1',
      [order.id],
    );
    check(
      'el pedido quedó como estaba',
      restored[0]?.picker_id === null && restored[0]?.status === 'paid',
      `picker=${restored[0]?.picker_id} status=${restored[0]?.status}`,
    );
    const { rows: hist } = await db.query(
      'SELECT count(*)::int AS n FROM order_status_history WHERE id > $1',
      [histMax],
    );
    check('no quedaron filas de historial de la prueba', hist[0].n === 0);
    await db.end();
    console.log('\n  limpieza: pedido restaurado y usuarios temporales eliminados');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
