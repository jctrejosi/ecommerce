/**
 * Verifica el orden de los tabs del admin de picking tras el login.
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-tabs-order.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9381;
const ADMIN = { username: 'qa-tabs-order', password: 'qa-tabs-1234' };
const EXPECTED = ['Mapa', 'Estanterías', 'Categorías', 'Productos', 'Pedidos', 'Usuarios', 'Horarios'];

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
  const db = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/ecommerce' });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Qa','Tabs',true,true,false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn('/usr/bin/chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1400,900', `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/cdp-tabs-${Date.now()}`, 'about:blank',
    ], { stdio: 'ignore' });

    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets.find((t) => t.type === 'page');
    const { ready, send } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send('Page.enable');
    await send('Runtime.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
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
      if (await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Horarios')`)) break;
      await sleep(300);
    }

    const order = await evaluate(`[...document.querySelectorAll('main button')].map(b => b.textContent.trim()).filter(t => ${JSON.stringify(EXPECTED)}.includes(t))`);
    console.log('Orden de tabs:', order.join(' | '));
    const ok = JSON.stringify(order) === JSON.stringify(EXPECTED);
    console.log(ok ? 'OK: coincide con el orden esperado' : `FALLO: se esperaba ${EXPECTED.join(' | ')}`);
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
