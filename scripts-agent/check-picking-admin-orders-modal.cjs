/**
 * Verifica el modal de detalle de pedidos del picking admin:
 *   1. Cada pedido abre un modal (no expande en línea) al hacer clic en la fila.
 *   2. El modal muestra cliente, alistamiento, entrega, pago, items e historial.
 *   3. Se cierra con Esc y con clic fuera.
 *   4. La API de detalle devuelve los campos completos (montos, dirección,
 *      ubicación de cada item y bitácora de estados).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-orders-modal.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9371;
const ADMIN = { username: 'qa-ordersmodal-admin', password: 'qa-ordersmodal-1234' };

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

const SET_INPUT = `
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };`;

async function main() {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  // Un pedido con items para abrir su detalle.
  const { rows: orderRows } = await db.query(
    `SELECT o.id, o.reference_code FROM orders o
     WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
     ORDER BY o.id LIMIT 1`,
  );
  if (orderRows.length === 0) throw new Error('No hay pedidos con items en la base');
  const ORDER = { id: Number(orderRows[0].id), ref: orderRows[0].reference_code };
  console.log('Pedido de prueba:', JSON.stringify(ORDER));

  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'OrdersModal', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    // ── API: campos completos del detalle ──────────────────────────────────
    console.log('\n== API del detalle ==');
    const res = await fetch(`${API}/picking/orders/${ORDER.id}`);
    const d = await res.json();
    check('responde 200', res.status === 200, String(res.status));
    check('incluye cliente con email', typeof d.customerEmail === 'string' || d.customerEmail === null);
    check('incluye montos del pedido', typeof d.subtotal === 'number' && typeof d.grandTotal === 'number', `subtotal=${d.subtotal} total=${d.grandTotal}`);
    check('incluye objeto de entrega', !!d.delivery && typeof d.delivery === 'object');
    check('incluye sucursal', !!d.branchName, d.branchName ?? 'null');
    check('incluye fechas de alistamiento', 'pickedAt' in d && 'completedAt' in d && 'deliveredAt' in d);
    check('los items traen ubicación de estantería', d.items.every((i) => 'shelfCode' in i && 'shelfName' in i));
    check('los items traen imagen y precios', d.items.every((i) => 'image' in i && typeof i.unitPriceGross === 'number'));
    check('incluye bitácora de estados', Array.isArray(d.timeline), `${d.timeline?.length ?? 0} eventos`);

    // ── UI ─────────────────────────────────────────────────────────────────
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1500,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-ordersmodal-${Date.now()}`, 'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        .then((r) => r.json()).catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets?.find((t) => t.type === 'page');
    if (!page) throw new Error('Chromium no expuso ninguna página');
    const { ready, send } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send('Page.enable');
    await send('Runtime.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      return r.result.value;
    };
    const clickAt = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    };
    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
      require('node:fs').writeFileSync(`scripts-agent/.scratch/${name}`, Buffer.from(s.data, 'base64'));
    };

    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('form input')`)) break;
      await sleep(250);
    }
    await evaluate(`(() => { ${SET_INPUT}
      const [user, pass] = document.querySelectorAll('form input');
      setValue(user, ${JSON.stringify(ADMIN.username)});
      setValue(pass, ${JSON.stringify(ADMIN.password)});
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`/estanterías en/.test(document.body.innerText)`)) break;
      await sleep(300);
    }

    // Todas las sucursales, para asegurar que el pedido aparezca.
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Todas');
      b?.click(); return !!b;
    })()`);
    await sleep(500);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Pedidos');
      b?.click(); return !!b;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('table tbody tr')`)) break;
      await sleep(300);
    }

    console.log('\n== Modal de detalle ==');
    const rowsBefore = await evaluate(`document.querySelectorAll('table tbody tr').length`);
    check('la tabla de pedidos tiene filas', rowsBefore > 0, `${rowsBefore} filas`);
    // Referencia del pedido de la primera fila (el que abriremos).
    const firstRef = await evaluate(`document.querySelector('table tbody tr td p')?.innerText?.trim() ?? ''`);

    // Clic en la primera fila.
    await evaluate(`(() => { document.querySelector('table tbody tr').click(); return true; })()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`/historial de estados/i.test(document.body.innerText)`)) break;
      await sleep(250);
    }
    const modalOpen = await evaluate(`/historial de estados/i.test(document.body.innerText)`);
    check('al clicar el pedido se abre el modal', modalOpen === true);
    const overlay = await evaluate(`(() => {
      const o = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('z-[60]') && d.className.includes('bg-black/60'));
      return o ? getComputedStyle(o).position : null;
    })()`);
    check('el detalle es un overlay fijo (no expande la fila)', overlay === 'fixed', overlay ?? 'sin overlay');
    const rowsAfter = await evaluate(`document.querySelectorAll('table tbody tr').length`);
    check('la tabla no añade filas (sin expansión en línea)', rowsAfter === rowsBefore, `${rowsBefore} → ${rowsAfter}`);

    const txt = await evaluate(`document.body.innerText`);
    check('muestra la sección Cliente', /cliente/i.test(txt));
    check('muestra la sección Alistamiento', /alistamiento/i.test(txt));
    check('muestra la sección Entrega', /entrega/i.test(txt));
    check('muestra la sección Pago', /pago/i.test(txt));
    check('muestra el total', /total/i.test(txt));
    check('muestra los items del pedido', /items del pedido \(\d+\)/i.test(txt));
    check('muestra la bitácora de estados', /historial de estados/i.test(txt));
    check('muestra la referencia del pedido abierto', firstRef !== '' && txt.includes(firstRef), firstRef);
    await shot('picking-admin-order-detail-modal.png');

    // Esc cierra.
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(350);
    check('Esc cierra el modal', await evaluate(`!/historial de estados/i.test(document.body.innerText)`));

    // Clic fuera cierra.
    await evaluate(`(() => { document.querySelector('table tbody tr').click(); return true; })()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`/historial de estados/i.test(document.body.innerText)`)) break;
      await sleep(200);
    }
    await clickAt(10, 10);
    await sleep(350);
    check('clic fuera cierra el modal', await evaluate(`!/historial de estados/i.test(document.body.innerText)`));

    console.log('\n  captura: scripts-agent/.scratch/picking-admin-order-detail-modal.png');
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
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
