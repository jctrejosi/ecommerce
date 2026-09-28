/**
 * Verifica la campanita de avisos de pedidos del picking admin:
 *   - existe en el header, al lado del chat,
 *   - arranca sin avisos y sin contador,
 *   - al cambiar el estado de un pedido (evento real `order:updated` del backend)
 *     aparece el contador de no leídos, la notificación del navegador y la línea
 *     en el desplegable,
 *   - al abrir el desplegable los avisos se marcan como leídos (el contador baja).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-bell.cjs
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

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const DEBUG_PORT = 9342;
const ADMIN = { username: 'qa-bell-admin', password: 'qa-bell-1234' };

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

  // Admin temporal para entrar al panel.
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Bell', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  // Pedido real para provocar el evento, con su estado original a restaurar.
  const { rows: orderRows } = await db.query(
    'SELECT id::int AS id, reference_code, status FROM orders ORDER BY id DESC LIMIT 1',
  );
  if (orderRows.length === 0) throw new Error('No hay pedidos para probar');
  const order = orderRows[0];
  const { rows: maxHist } = await db.query(
    'SELECT COALESCE(MAX(id), 0)::bigint AS m FROM order_status_history WHERE order_id = $1',
    [order.id],
  );
  const histBefore = BigInt(maxHist[0].m);
  const target = order.status === 'shipped' ? 'entregado' : 'en camino';
  const targetDb = target === 'entregado' ? 'delivered' : 'shipped';

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1400,900',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-bell-${Date.now()}`,
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
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      }
      return r.result.value;
    };

    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('form input')`)) break;
      await sleep(250);
    }

    // Espía de la Notification del navegador: ese es el aviso que se espera.
    await evaluate(`(() => {
      window.__notifs = [];
      class NotificationSpy {
        constructor(title, opts) { window.__notifs.push({ title, body: opts?.body ?? null }); }
        close() {}
      }
      NotificationSpy.permission = 'granted';
      NotificationSpy.requestPermission = async () => 'granted';
      window.Notification = NotificationSpy;
      return true;
    })()`);

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
    await evaluate(`(() => {
      window.__notifs = [];
      return true;
    })()`);

    // ── La campanita existe, junto al chat ─────────────────────────────────
    const layout = await evaluate(`(() => {
      const bell = document.querySelector('button[aria-label="Avisos de pedidos"]');
      const chat = document.querySelector('button[aria-label="Chat con los pickers"]');
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right) }; };
      return { bell: r(bell), chat: r(chat), badge: bell ? !!bell.querySelector('span') : null };
    })()`);
    check('la campanita está en el header', !!layout.bell, JSON.stringify(layout.bell));
    check('el chat sigue en el header', !!layout.chat, JSON.stringify(layout.chat));
    check(
      'la campanita está en la misma fila que el chat',
      !!layout.bell && !!layout.chat && Math.abs(layout.bell.top - layout.chat.top) <= 2,
      `bell.top=${layout.bell?.top} chat.top=${layout.chat?.top}`,
    );
    check(
      'la campanita está pegada al chat',
      !!layout.bell && !!layout.chat && Math.abs(layout.chat.left - layout.bell.right) < 40,
      `bell.right=${layout.bell?.right} chat.left=${layout.chat?.left}`,
    );

    // Abrir y cerrar para partir de "sin avisos leídos".
    await evaluate(`document.querySelector('button[aria-label="Avisos de pedidos"]').click()`);
    await sleep(300);
    const openState = await evaluate(`(() => {
      const p = [...document.querySelectorAll('p')].find((x) => x.textContent.trim() === 'Avisos de pedidos');
      return { open: !!p, empty: document.body.innerText.includes('Sin novedades todavía.') };
    })()`);
    check('al pulsarla se abre el desplegable', openState.open, JSON.stringify(openState));
    check('el panel arranca sin avisos', openState.empty, String(openState.empty));
    await evaluate(`document.querySelector('button[aria-label="Avisos de pedidos"]').click()`);
    await sleep(300);

    // ── Evento real: cambio de estado del pedido ───────────────────────────
    const res = await fetch(`${API_URL}/admin/orders/${order.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: target }),
    });
    if (!res.ok) throw new Error(`No se pudo cambiar el estado: HTTP ${res.status}`);

    for (let i = 0; i < 40; i++) {
      if (await evaluate(`!!document.querySelector('button[aria-label="Avisos de pedidos"] span')`)) break;
      await sleep(250);
    }

    const after = await evaluate(`(() => {
      const bell = document.querySelector('button[aria-label="Avisos de pedidos"]');
      return { badge: bell?.querySelector('span')?.textContent?.trim() ?? null };
    })()`);
    check('aparece el contador de no leídos en la campanita', !!after.badge, String(after.badge));

    const notifs = await evaluate(`window.__notifs`);
    check(
      'se dispara la notificación del navegador',
      Array.isArray(notifs) && notifs.length >= 1,
      JSON.stringify(notifs?.[0] ?? null),
    );
    check(
      'la notificación es del pedido con su nueva acción',
      !!notifs?.[0]?.title?.includes(order.reference_code),
      notifs?.[0]?.title ?? 'sin notificación',
    );

    // ── El desplegable lista el aviso y lo marca como leído ────────────────
    await evaluate(`document.querySelector('button[aria-label="Avisos de pedidos"]').click()`);
    await sleep(400);
    const list = await evaluate(`(() => {
      const items = [...document.querySelectorAll('li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim());
      const bell = document.querySelector('button[aria-label="Avisos de pedidos"]');
      return { items, badge: bell?.querySelector('span')?.textContent?.trim() ?? null };
    })()`);
    check(
      'el desplegable lista el aviso del pedido',
      list.items.some((t) => t.includes(order.reference_code)),
      JSON.stringify(list.items.slice(0, 2)),
    );
    check(
      'al abrirlo se marcan como leídos (baja el contador)',
      list.badge === null,
      `badge=${list.badge ?? 'null'}`,
    );

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-admin-bell.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-admin-bell.png');
  } finally {
    chrome?.kill('SIGKILL');
    // Restaurar el pedido y borrar el histórico que añadió la prueba.
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', [order.status, order.id]);
    await db.query(
      'DELETE FROM order_status_history WHERE order_id = $1 AND id > $2',
      [order.id, histBefore.toString()],
    );
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
    console.log('\n  limpieza: pedido restaurado y admin temporal eliminado');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
