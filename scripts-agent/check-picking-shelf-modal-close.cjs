/**
 * Verifica que la "X" de cerrar del modal de estantería sea visible en tema claro
 * y oscuro (antes usaba `stroke="white"` fijo, invisible sobre fondo claro).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-shelf-modal-close.cjs
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
const DEBUG_PORT = 9366;
const ADMIN = { username: 'qa-close-admin', password: 'qa-close-1234' };

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

// Color de la "X" del modal y fondo efectivo detrás de ella.
const CLOSE_METRICS = `(() => {
  const path = [...document.querySelectorAll('svg path')].find((p) => p.getAttribute('d') === 'M18 6L6 18M6 6l12 12');
  if (!path) return null;
  const btn = path.ownerSVGElement.closest('button');
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d');
  const toRgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  const stroke = toRgb(getComputedStyle(path).stroke);
  let el = btn, bg = [0, 0, 0, 0];
  while (el) { const c = toRgb(getComputedStyle(el).backgroundColor); if (c[3] > 200) { bg = c; break; } el = el.parentElement; }
  const lum = (rgb) => { const f = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const L1 = lum(stroke); const L2 = lum(bg);
  return { stroke, bg, ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100 };
})()`;

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Close', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-close-${Date.now()}`, 'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).catch(() => null);
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
      if (await evaluate(`/estanterías en/.test(document.body.innerText)`)) break;
      await sleep(300);
    }

    const openNewShelf = async () => {
      await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Nueva estantería')); b?.click(); return true; })()`);
      for (let i = 0; i < 40; i++) {
        if (await evaluate(`document.body.innerText.includes('Nueva estantería')`)) break;
        await sleep(200);
      }
      await sleep(200);
    };
    const closeModal = async () => {
      await evaluate(`(() => { const p = [...document.querySelectorAll('svg path')].find((p) => p.getAttribute('d') === 'M18 6L6 18M6 6l12 12'); p?.ownerSVGElement.closest('button').click(); return true; })()`);
      await sleep(300);
    };

    // ── Modo claro ─────────────────────────────────────────────────────────
    console.log('\n== Modo claro ==');
    await evaluate(`localStorage.setItem('picking-admin-theme', 'amber:light'); location.reload();`);
    await sleep(1200);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`/estanterías en/.test(document.body.innerText)`)) break;
      await sleep(300);
    }
    check('el tema quedó en claro', (await evaluate(`document.documentElement.dataset.mode`)) === 'light');
    await openNewShelf();
    const light = await evaluate(CLOSE_METRICS);
    check('existe la "X" de cerrar en el modal', !!light, JSON.stringify(light));
    check('el fondo del modal es claro', !!light && light.bg[0] > 150, `bg rgb(${light?.bg?.slice(0, 3)})`);
    check('la "X" es oscura (visible en claro)', !!light && light.stroke[0] < 130, `stroke rgb(${light?.stroke?.slice(0, 3)})`);
    check('contraste de la "X" suficiente (>= 3)', !!light && light.ratio >= 3, `ratio ${light?.ratio}`);
    {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
      require('node:fs').writeFileSync('scripts-agent/.scratch/picking-shelf-modal-close-light.png', Buffer.from(s.data, 'base64'));
    }
    await closeModal();

    // ── Modo oscuro ────────────────────────────────────────────────────────
    console.log('\n== Modo oscuro ==');
    await evaluate(`localStorage.setItem('picking-admin-theme', 'amber:dark'); location.reload();`);
    await sleep(1200);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`/estanterías en/.test(document.body.innerText)`)) break;
      await sleep(300);
    }
    await openNewShelf();
    const dark = await evaluate(CLOSE_METRICS);
    check('en oscuro la "X" es clara', !!dark && dark.stroke[0] > 150, `stroke rgb(${dark?.stroke?.slice(0, 3)})`);
    check('contraste de la "X" en oscuro (>= 3)', !!dark && dark.ratio >= 3, `ratio ${dark?.ratio}`);
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
    console.log('\n  capturas: scripts-agent/.scratch/picking-shelf-modal-close-light.png');
    console.log('\n  limpieza: admin temporal eliminado');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
