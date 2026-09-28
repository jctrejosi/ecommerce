/**
 * Verifica el footer de copyright del picking admin:
 *   - usa el mismo logo y tamaño que el footer del admin general (26px),
 *   - el pie quedó más compacto (altura y textos pequeños),
 *   - sigue pegado al pie de la pantalla y con el fondo institucional.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-footer.cjs
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

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9341;
const ADMIN = { username: 'qa-footer-admin', password: 'qa-footer-1234' };
/** Altura del logo del footer en el panel admin general (`h-[26px]`). */
const EXPECTED_LOGO_H = 26;
/** Tope de altura del pie: antes medía ~50px con el logo de 32px. */
const MAX_FOOTER_H = 46;

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
     VALUES ($1, $2, $3, 'Qa', 'Footer', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1400,900',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-footer-${Date.now()}`,
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
    // Antes de entrar, el pie del login (es el mismo componente).
    const loginFooter = await evaluate(`(() => {
      const f = document.querySelector('footer');
      if (!f) return null;
      const img = f.querySelector('img');
      const r = f.getBoundingClientRect();
      const ri = img?.getBoundingClientRect();
      return { h: Math.round(r.height), logoH: ri ? Math.round(ri.height) : null, bg: getComputedStyle(f).backgroundColor };
    })()`);

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

    const footer = await evaluate(`(() => {
      const f = document.querySelector('footer');
      const r = f.getBoundingClientRect();
      const img = f.querySelector('img');
      const ri = img.getBoundingClientRect();
      return {
        h: Math.round(r.height),
        bottom: Math.round(r.bottom),
        viewport: window.innerHeight,
        logoH: Math.round(ri.height),
        logoLoaded: img.naturalWidth > 0,
        src: img.src,
        bg: getComputedStyle(f).backgroundColor,
        text: f.innerText.replace(/\\s+/g, ' ').trim(),
        fontSize: getComputedStyle(f.querySelector('p')).fontSize,
      };
    })()`);

    console.log('\n== Footer del panel ==');
    console.log(`  altura ${footer.h}px · logo ${footer.logoH}px · texto ${footer.fontSize}`);
    check(
      'el logo es del tamaño del footer del admin (26px)',
      Math.abs(footer.logoH - EXPECTED_LOGO_H) <= 1,
      `${footer.logoH}px`,
    );
    check('el logo cargó', footer.logoLoaded, footer.src.slice(0, 60));
    check(
      'el footer quedó compacto',
      footer.h <= MAX_FOOTER_H,
      `${footer.h}px (tope ${MAX_FOOTER_H})`,
    );
    check('el texto es pequeño', parseFloat(footer.fontSize) <= 11.5, footer.fontSize);
    check(
      'sigue pegado al pie de la pantalla',
      Math.abs(footer.bottom - footer.viewport) <= 1,
      `bottom=${footer.bottom} viewport=${footer.viewport}`,
    );
    check('mantiene el fondo institucional (#111827)', footer.bg === 'rgb(17, 24, 39)', footer.bg);
    check(
      'mantiene el texto de copyright',
      footer.text.includes('DSI SA') && footer.text.includes('Manizales'),
      footer.text,
    );
    if (loginFooter) {
      check(
        'el pie del login es igual de compacto',
        loginFooter.h <= MAX_FOOTER_H && Math.abs(loginFooter.logoH - EXPECTED_LOGO_H) <= 1,
        `altura ${loginFooter.h}px · logo ${loginFooter.logoH}px`,
      );
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-admin-footer.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-admin-footer.png');
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
