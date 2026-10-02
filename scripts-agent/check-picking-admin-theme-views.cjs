/**
 * Recorre todas las vistas del admin de picking con el tema Claro (light) y deja
 * una captura de cada una para revisar legibilidad. Además comprueba que el texto
 * del footer sea oscuro (visible) sobre el fondo claro.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-theme-views.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');
const fs = require('node:fs');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9351;
const ADMIN = { username: 'qa-views-admin', password: 'qa-views-1234' };
const TABS = ['Estanterías', 'Categorías', 'Mapa', 'Productos', 'Pedidos', 'Usuarios', 'Horarios'];

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
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Views', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  const shots = [];
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,950', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-views-${Date.now()}`, 'about:blank',
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
    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const file = `scripts-agent/.scratch/picking-admin-light-${name}.png`;
      fs.mkdirSync('scripts-agent/.scratch', { recursive: true });
      fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
      shots.push(file);
    };
    const clickByText = (text) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
        b?.click(); return !!b;
      })()`);

    // Login.
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
      if (await evaluate(`!!document.querySelector('button[aria-label="Cambiar tema"]')`)) break;
      await sleep(300);
    }

    // Aplica el tema Claro por la UI.
    await evaluate(`document.querySelector('button[aria-label="Cambiar tema"]').click()`);
    await sleep(200);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Claro'));
      b?.click(); return !!b;
    })()`);
    await sleep(300);
    const theme = await evaluate(`document.documentElement.dataset.theme`);
    check('el tema activo es light', theme === 'light', theme);

    // El footer es una banda institucional fija (#111827) en todos los temas, así
    // que en claro debe conservar ese fondo, con texto claro encima (contraste ok).
    const footer = await evaluate(`(() => {
      const f = document.querySelector('footer');
      if (!f) return null;
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const ctx = cv.getContext('2d');
      const rgb = (color) => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
      };
      return { bg: rgb(getComputedStyle(f).backgroundColor), fg: rgb(getComputedStyle(f.querySelector('p')).color) };
    })()`);
    const lum = (rgb) => rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
    check(
      'el footer conserva el fondo institucional #111827 en claro',
      footer && footer.bg.join(',') === '17,24,39',
      `rgb(${footer?.bg})`,
    );
    check(
      'el texto del footer es claro (contrasta con la banda oscura)',
      footer && lum(footer.fg) > 100,
      `rgb(${footer?.fg}) (lum ${Math.round(lum(footer?.fg ?? [0, 0, 0]))})`,
    );

    // Recorre cada tab.
    for (const tab of TABS) {
      const clicked = await clickByText(tab);
      check(`abre la pestaña ${tab}`, clicked);
      await sleep(500);
      await shot(tab.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    }

    console.log('\n  capturas:');
    shots.forEach((s) => console.log(`    ${s}`));
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
