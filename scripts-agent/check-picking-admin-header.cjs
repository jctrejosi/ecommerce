/**
 * Verifica el header del picking admin:
 *   - junto al logo de DSI aparece el logo de la tienda configurado en el admin
 *     (el de `/landing/general`), en la misma fila y a su derecha,
 *   - el título "Picking Admin" queda DEBAJO de los dos logos,
 *   - ya no está el subtítulo "Estanterías y ubicaciones por sucursal".
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-header.cjs
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

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9340;
const ADMIN = { username: 'qa-header-admin', password: 'qa-header-1234' };

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
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Header', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    // Logo configurado en el admin general (lo que debe pintar el header).
    const info = await fetch(`${BASE}/landing/general`).then((r) => r.json());
    const expectedLogo = info?.url ?? null;
    check('el admin tiene un logo de tienda configurado', !!expectedLogo, String(expectedLogo).slice(0, 60));

    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1400,900',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-header-${Date.now()}`,
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
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
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
      if (await evaluate(`document.body.innerText.includes('Estanterías')`)) break;
      await sleep(250);
    }
    // Esperar a que el logo de la tienda (viene de Cloudinary vía backend) exista
    // y termine de cargar: su naturalWidth solo es > 0 al completar la descarga.
    for (let i = 0; i < 60; i++) {
      const loaded = await evaluate(
        `(() => { const el = document.querySelector('header img[alt="Tienda"]'); return !!el && el.complete && el.naturalWidth > 0; })()`,
      );
      if (loaded) break;
      await sleep(300);
    }

    const m = await evaluate(`(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
      };
      const dsi = document.querySelector('header img[alt="DSI"]');
      const store = document.querySelector('header img[alt="Tienda"]');
      const title = document.querySelector('header h1');
      return {
        dsi: rect(dsi),
        store: rect(store),
        title: rect(title),
        storeSrc: store ? store.src : null,
        storeLoaded: store ? store.naturalWidth > 0 : false,
        titleText: title ? title.textContent.trim() : null,
        hasSubtitle: document.body.innerText.includes('Estanterías y ubicaciones por sucursal'),
      };
    })()`);

    console.log('\n== Header ==');
    check('el logo de DSI sigue en el header', !!m.dsi);
    check('el logo de la tienda está en el header', !!m.store, m.storeSrc ?? 'no encontrado');
    check('el logo de la tienda es el configurado en el admin', m.storeSrc === expectedLogo, m.storeSrc ?? '');
    check('el logo de la tienda cargó de verdad', m.storeLoaded, `ancho ${m.store?.w}px`);
    check(
      'está al lado del logo de DSI (misma fila, a la derecha)',
      !!m.dsi && !!m.store && m.store.left > m.dsi.left && Math.abs(m.store.top - m.dsi.top) <= 6,
      `DSI left=${m.dsi?.left} top=${m.dsi?.top} · tienda left=${m.store?.left} top=${m.store?.top}`,
    );
    check(
      'el título "Picking Admin" queda debajo de los logos',
      !!m.title && m.title.top >= Math.max(m.dsi?.bottom ?? 0, m.store?.bottom ?? 0) - 2,
      `título top=${m.title?.top} · logos bottom=${Math.max(m.dsi?.bottom ?? 0, m.store?.bottom ?? 0)}`,
    );
    check('el título dice "Picking Admin"', m.titleText === 'Picking Admin', m.titleText ?? '');
    check('ya no está el subtítulo', m.hasSubtitle === false);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-admin-header.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-admin-header.png');
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
