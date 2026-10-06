/**
 * Abre la pestaña Productos del picking admin, hace clic en el primer producto
 * con estantería y captura el modal (detalle + miniatura del mapa titilando).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/shot-product-modal.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9368;
const ADMIN = { username: 'qa-shot-products', password: 'qa-shot-1234' };

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
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Shot', true, true, false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1400', '--force-device-scale-factor=1',
        `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/cdp-prod-${Date.now()}`, 'about:blank',
      ],
      { stdio: 'ignore' },
    );
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
    // Espera a las tabs del panel.
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Productos')`)) break;
      await sleep(300);
    }

    // Pestaña Productos.
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Productos');
      b?.click(); return !!b;
    })()`);

    // Espera a las tarjetas de producto (botones con "SKU").
    let cards = 0;
    for (let i = 0; i < 60; i++) {
      cards = await evaluate(`[...document.querySelectorAll('button')].filter(b => /SKU/.test(b.textContent)).length`);
      if (cards > 0) break;
      await sleep(300);
    }
    console.log(`tarjetas de producto: ${cards}`);

    // Clic en el primer producto CON estantería (chip ámbar); si ninguno, el primero.
    const clicked = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => /SKU/.test(b.textContent));
      const withShelf = btns.find(b => b.innerHTML.includes('bg-amber-400/10'));
      const target = withShelf || btns[0];
      target?.click();
      return target ? target.textContent.slice(0, 60) : null;
    })()`);
    console.log(`producto abierto: ${clicked}`);

    // Espera al parpadeo de la estantería.
    let blink = 0;
    for (let i = 0; i < 40; i++) {
      blink = await evaluate(`document.querySelectorAll('.shelf-blink').length`);
      if (blink > 0) break;
      await sleep(250);
    }
    console.log(`estanterías titilando: ${blink}`);
    await sleep(500);

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    const out = 'scripts-agent/.scratch/picking-product-modal.png';
    require('node:fs').writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`captura: ${out}`);
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
