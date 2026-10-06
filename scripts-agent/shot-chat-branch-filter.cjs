/**
 * Captura el modal de chat del header y verifica el filtro por sucursal:
 * con "Todas" lista N pickers; al elegir una sucursal, solo los de esa tienda.
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/shot-chat-branch-filter.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9387;
const ADMIN = { username: 'qa-chat-shot', password: 'qa-chat-shot1' };

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
     VALUES ($1,$2,$3,'Qa','ChatShot',true,true,false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn('/usr/bin/chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1400,1100', '--force-device-scale-factor=1',
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/cdp-chat-${Date.now()}`, 'about:blank',
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
      if (await evaluate(`!!document.querySelector('[aria-label="Chat con los pickers"]')`)) break;
      await sleep(300);
    }

    // Abre el modal de chat.
    await evaluate(`document.querySelector('[aria-label="Chat con los pickers"]').click()`);
    const countRows = `[...document.querySelectorAll('button')].filter(b => /@\\w/.test(b.textContent)).length`;
    for (let i = 0; i < 40; i++) {
      if ((await evaluate(countRows)) > 0) break;
      await sleep(300);
    }
    const allCount = await evaluate(countRows);
    console.log(`[Todas] pickers en la bandeja: ${allCount}`);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync('scripts-agent/.scratch/chat-branch-all.png', Buffer.from(shot.data, 'base64'));

    // Cambia el select a "TID Sucursal 2".
    const changed = await evaluate(`(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === 'TID Sucursal 2'));
      if (!sel) return 'no-select';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      const opt = [...sel.options].find(o => o.textContent === 'TID Sucursal 2');
      setter.call(sel, opt.value); sel.dispatchEvent(new Event('change', { bubbles: true }));
      return '+' + opt.textContent;
    })()`);
    console.log(`select -> ${changed}`);
    await sleep(600);
    console.log(`[TID Sucursal 2] pickers en la bandeja: ${await evaluate(countRows)}`);

    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').writeFileSync('scripts-agent/.scratch/chat-branch-tid2.png', Buffer.from(shot2.data, 'base64'));
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
