/**
 * Verifica que el tab de Pedidos filtre por la sucursal seleccionada.
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-orders-branch-filter.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9370;
const ADMIN = { username: 'qa-orders-branch', password: 'qa-shot-1234' };

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
  const counts = await db.query(
    `SELECT b.name, COUNT(o.id)::int AS n FROM branches b
       LEFT JOIN orders o ON o.branch_id = b.id
      WHERE b.is_active = true GROUP BY b.name ORDER BY b.name`,
  );
  const totalAll = await db.query(`SELECT COUNT(*)::int AS n FROM orders`);
  console.log('BD por sucursal:', counts.rows.map((r) => `${r.name}=${r.n}`).join(', '), `| total=${totalAll.rows[0].n}`);

  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1,$2,$3,'Qa','Orders',true,true,false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn('/usr/bin/chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1400,1600', '--force-device-scale-factor=1',
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/cdp-orders-${Date.now()}`, 'about:blank',
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
      if (await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Pedidos')`)) break;
      await sleep(300);
    }
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Pedidos')?.click()`);

    const readSummary = `(() => {
      const p = [...document.querySelectorAll('p')].find(p => /pedido(s)?$/.test(p.textContent.trim()) && /·/.test(p.textContent));
      return p ? p.textContent.trim() : null;
    })()`;

    for (let i = 0; i < 50; i++) {
      const s = await evaluate(readSummary);
      if (s && !/^.*· 0 pedido/.test(s)) break;
      if (s) break;
      await sleep(300);
    }
    // Sucursal por defecto (primera)
    await sleep(500);
    const withBranch = await evaluate(readSummary);
    console.log(`\n[Sucursal seleccionada] resumen del tab Pedidos: "${withBranch}"`);

    // Códigos de referencia visibles -> cruzar contra la BD.
    const codes = await evaluate(`(() => {
      const set = new Set();
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length) continue;
        const t = el.textContent.trim();
        if (/^MER-\\d+$/.test(t)) set.add(t);
      }
      return [...set];
    })()`);
    const check = await db.query(
      `SELECT branch_id, COUNT(*)::int AS n FROM orders WHERE reference_code = ANY($1) GROUP BY branch_id`,
      [codes],
    );
    console.log(`Códigos visibles: ${codes.length} -> por sucursal en BD: ${JSON.stringify(check.rows.map((r) => `${r.branch_id}:${r.n}`))}`);

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-orders-branch.png', Buffer.from(shot.data, 'base64'));

    // Cambiar a TID Sucursal 11.
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'TID Sucursal 11')?.click()`);
    await sleep(1500);
    console.log(`[TID Sucursal 11] resumen del tab Pedidos: "${await evaluate(readSummary)}"`);

    // Ahora "Todas"
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Todas')?.click()`);
    await sleep(1500);
    const allBranches = await evaluate(readSummary);
    console.log(`[Todas] resumen del tab Pedidos: "${allBranches}"`);
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
