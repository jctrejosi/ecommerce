/**
 * Mide el contraste (WCAG) del texto de los botones "activos" en cada preset:
 *   - la tab activa del panel,
 *   - el filtro activo de la pestaña Pedidos,
 *   - la opción activa del menú de temas.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-theme-contrast.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9359;
const ADMIN = { username: 'qa-contrast-admin', password: 'qa-contrast-1234' };
// El último es "color:modo" explícito para cubrir el modo claro (el preset
// antiguo "light" migraría igual, pero así queda claro qué se está probando).
const PRESETS = ['amber', 'blue', 'violet', 'amber:light'];
const MIN = 3.0; // AA para texto en negrita/grande; buscamos muy por encima.

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

// Contraste WCAG de un botón localizado por su texto exacto.
const CONTRAST_BY_TEXT = (label) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d');
  const toRgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const cs = getComputedStyle(b);
  const fg = toRgb(cs.color); const bg = toRgb(cs.backgroundColor);
  const lum = (rgb) => { const f = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const L1 = lum(fg); const L2 = lum(bg);
  return { fg, bg, ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100 };
})()`;

// La opción activa del menú de temas es el botón de modo (Claro/Oscuro) con
// fondo opaco; el color activo también lo tiene, pero es un swatch sin texto.
const ACTIVE_THEME_ITEM = `(() => {
  const item = document.querySelector('button[aria-label^="Modo "][aria-pressed="true"]');
  if (!item) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d');
  const toRgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const cs = getComputedStyle(item);
  const fg = toRgb(cs.color); const bg = toRgb(cs.backgroundColor);
  const lum = (rgb) => { const f = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const L1 = lum(fg); const L2 = lum(bg);
  return { label: item.getAttribute('aria-label'), fg, bg, ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100 };
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
     VALUES ($1, $2, $3, 'Qa', 'Contrast', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,900', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-contrast-${Date.now()}`, 'about:blank',
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
    const { ready, send } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send('Page.enable');
    await send('Runtime.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      return r.result.value;
    };

    // Login una vez; el resto se hace recargando con cada preset.
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
      if (await evaluate(`!!document.querySelector('button[aria-label="Opciones del usuario"]')`)) break;
      await sleep(300);
    }

    for (const preset of PRESETS) {
      console.log(`\n== Preset ${preset} ==`);
      await evaluate(`localStorage.setItem('picking-admin-theme', ${JSON.stringify(preset)}); location.reload();`);
      await sleep(1200);
      for (let i = 0; i < 40; i++) {
        if (await evaluate(`!!document.querySelector('button[aria-label="Opciones del usuario"]')`)) break;
        await sleep(250);
      }

      // Tab activa (por defecto, Estanterías).
      const tab = await evaluate(CONTRAST_BY_TEXT('Estanterías'));
      check(`tab activa "${preset}" legible`, tab && tab.ratio >= MIN, tab ? `ratio ${tab.ratio} (fg ${tab.fg} / bg ${tab.bg})` : 'no encontrada');

      // Filtro activo de Pedidos (por defecto, Todos).
      await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Pedidos'); b?.click(); return true; })()`);
      await sleep(600);
      // El chip incluye el contador, así que se localiza por su etiqueta parcial.
      const chip2 = await evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Todos'));
        if (!b) return null;
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const ctx = cv.getContext('2d');
        const toRgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
        const cs = getComputedStyle(b);
        const fg = toRgb(cs.color); const bg = toRgb(cs.backgroundColor);
        const lum = (rgb) => { const f = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
        const L1 = lum(fg); const L2 = lum(bg);
        return { fg, bg, ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100 };
      })()`);
      check(`filtro activo de Pedidos "${preset}" legible`, chip2 && chip2.ratio >= MIN, chip2 ? `ratio ${chip2.ratio} (fg ${chip2.fg} / bg ${chip2.bg})` : 'no encontrado');

      // Opción activa del menú de temas.
      await evaluate(`document.querySelector('button[aria-label="Opciones del usuario"]').click()`);
      await sleep(300);
      const item = await evaluate(ACTIVE_THEME_ITEM);
      check(`opción activa del menú "${preset}" legible`, item && item.ratio >= MIN, item ? `ratio ${item.ratio} (fg ${item.fg} / bg ${item.bg})` : 'no encontrada');
      await evaluate(`document.querySelector('button[aria-label="Opciones del usuario"]').click()`);
      await sleep(200);
    }
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
