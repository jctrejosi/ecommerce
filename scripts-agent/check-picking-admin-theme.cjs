/**
 * Verifica el cambio de temas (presets) del admin de picking:
 *   - El botón "Cambiar tema" está en las opciones del usuario del header.
 *   - Elegir un preset cambia `data-theme` y el color de fondo real.
 *   - La elección persiste tras recargar.
 *   - Quedan capturas del tema oscuro y claro.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-theme.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9349;
const ADMIN = { username: 'qa-theme-admin', password: 'qa-theme-1234' };

// Fondo esperado de cada preset (`--app`).
const BG = {
  amber: 'rgb(12, 12, 13)',
  blue: 'rgb(10, 15, 26)',
  violet: 'rgb(12, 10, 20)',
  light: 'rgb(244, 245, 247)',
};

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

const STATE = `(() => ({
  theme: document.documentElement.dataset.theme || null,
  bg: getComputedStyle(document.body).backgroundColor,
}))()`;

// El botón del preset contiene el swatch + label + hint, así que se compara por
// inclusión del label (no por igualdad) y evitando botones de otras vistas.
const PICK_THEME = (label) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(label)}));
  b?.click(); return !!b;
})()`;

async function main() {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Theme', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-theme-${Date.now()}`, 'about:blank',
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
    const login = async () => {
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
    };

    await login();

    const initial = await evaluate(STATE);
    check('tema por defecto = amber', initial.theme === 'amber', `${initial.theme}`);
    check('fondo oscuro por defecto', initial.bg === BG.amber, initial.bg);

    // ── Claro ────────────────────────────────────────────────────────────────
    await evaluate(`document.querySelector('button[aria-label="Cambiar tema"]').click()`);
    await sleep(250);
    // La clase `uppercase` del título hace que innerText venga en mayúsculas.
    const hasMenu = await evaluate(`/Tema/i.test(document.body.innerText)`);
    check('el botón despliega el menú de temas', hasMenu);
    await evaluate(PICK_THEME('Claro'));
    await sleep(300);
    const light = await evaluate(STATE);
    check('elige el tema Claro', light.theme === 'light', `${light.theme}`);
    check('el fondo cambia a claro', light.bg === BG.light, light.bg);
    const shotLight = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-theme-light.png', Buffer.from(shotLight.data, 'base64'));

    // ── Persistencia ─────────────────────────────────────────────────────────
    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('button[aria-label="Cambiar tema"]')`)) break;
      await sleep(300);
    }
    const afterReload = await evaluate(STATE);
    check('la elección persiste tras recargar', afterReload.theme === 'light' && afterReload.bg === BG.light, `${afterReload.theme} ${afterReload.bg}`);

    // ── Azul ─────────────────────────────────────────────────────────────────
    await evaluate(`document.querySelector('button[aria-label="Cambiar tema"]').click()`);
    await sleep(250);
    await evaluate(PICK_THEME('Azul'));
    await sleep(300);
    const blue = await evaluate(STATE);
    check('elige el tema Azul', blue.theme === 'blue', `${blue.theme}`);
    check('el fondo cambia al azul oscuro', blue.bg === BG.blue, blue.bg);

    // ── Vuelve a oscuro (ámbar) para la captura y para dejar el panel igual ──
    await evaluate(`document.querySelector('button[aria-label="Cambiar tema"]').click()`);
    await sleep(250);
    await evaluate(PICK_THEME('Ámbar'));
    await sleep(300);
    const back = await evaluate(STATE);
    check('vuelve a Ámbar', back.theme === 'amber' && back.bg === BG.amber, `${back.theme} ${back.bg}`);
    const shotDark = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-theme-dark.png', Buffer.from(shotDark.data, 'base64'));

    console.log('\n  capturas: scripts-agent/.scratch/picking-admin-theme-light.png, -dark.png');
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
