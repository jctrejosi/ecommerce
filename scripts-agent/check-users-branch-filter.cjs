/**
 * Verifica que el tab de Usuarios filtra por la sucursal seleccionada.
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-users-branch-filter.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9369;
const ADMIN = { username: 'qa-users-branch', password: 'qa-shot-1234' };

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
     VALUES ($1,$2,$3,'Qa','Users',true,true,false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn('/usr/bin/chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1400,1400', '--force-device-scale-factor=1',
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/cdp-users-${Date.now()}`, 'about:blank',
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
      if (await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Usuarios')`)) break;
      await sleep(300);
    }
    // Ir a Usuarios.
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Usuarios')?.click()`);

    const readState = `(() => {
      const selects = [...document.querySelectorAll('select')].filter(s => [...s.options].some(o => /Sin sucursal/.test(o.textContent)));
      const values = selects.map(s => s.value || 'sin-sucursal');
      const branch = [...document.querySelectorAll('button')].filter(b => /TID Sucursal/.test(b.textContent) && /bg-amber-400/.test(b.className)).map(b => b.textContent.trim());
      return { count: selects.length, values, branch };
    })()`;

    for (let i = 0; i < 40; i++) {
      const s = await evaluate(readState);
      if (s.count > 0) break;
      await sleep(300);
    }
    const withBranch = await evaluate(readState);
    console.log(`Sucursal activa: ${JSON.stringify(withBranch.branch)}`);
    console.log(`Usuarios visibles: ${withBranch.count} -> sucursales ${JSON.stringify(withBranch.values)}`);

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    const out = 'scripts-agent/.scratch/picking-users-branch.png';
    require('node:fs').writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`captura: ${out}`);

    // Cambiar a "Todas".
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Todas')?.click()`);
    await sleep(1200);
    const all = await evaluate(readState);
    console.log(`[Todas] Usuarios visibles: ${all.count} -> sucursales ${JSON.stringify(all.values)}`);
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
