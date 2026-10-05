/**
 * Verifica el cambio de tema del admin de picking, ahora en dos ejes:
 *   - El botón "Cambiar tema" está en las opciones del usuario del header.
 *   - El menú tiene colores (Ámbar/Azul/Violeta) y un conmutador Oscuro/Claro.
 *   - Color y modo son independientes y cambian `data-theme`/`data-mode` y el fondo.
 *   - La elección persiste tras recargar.
 *   - Quedan capturas de oscuro, claro y azul oscuro.
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

// Fondo esperado de cada color en modo oscuro (`--app`), y el modo claro.
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
  mode: document.documentElement.dataset.mode || null,
  bg: getComputedStyle(document.body).backgroundColor,
}))()`;

// Los colores son swatches sin texto (aria-label "Color <nombre>"); los modos son
// botones circulares con ícono (aria-label "Modo <nombre>").
const CLICK_MODE = (label) => `(() => {
  const b = document.querySelector(${JSON.stringify(`button[aria-label="Modo ${label}"]`)});
  b?.click(); return !!b;
})()`;
const CLICK_COLOR = (label) => `(() => {
  const b = document.querySelector(${JSON.stringify(`button[aria-label="Color ${label}"]`)});
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
        if (await evaluate(`!!document.querySelector('button[aria-label="Opciones del usuario"]')`)) break;
        await sleep(300);
      }
    };

    await login();

    const initial = await evaluate(STATE);
    check('tema por defecto = ámbar/oscuro', initial.theme === 'amber' && initial.mode === 'dark', `${initial.theme}/${initial.mode}`);
    check('fondo oscuro por defecto', initial.bg === BG.amber, initial.bg);

    // ── Menú: color + modo ───────────────────────────────────────────────────
    await evaluate(`document.querySelector('button[aria-label="Opciones del usuario"]').click()`);
    await sleep(250);
    // La clase `uppercase` de los títulos hace que innerText venga en mayúsculas.
    const menuText = await evaluate(`document.body.innerText`);
    check('el menú muestra "Color" y "Modo"', /color/i.test(menuText) && /modo/i.test(menuText));
    check('hay 3 colores seleccionables', await evaluate(`document.querySelectorAll('button[aria-label^="Color "]').length === 3`));
    check(
      'hay botones de modo Claro, Oscuro y Sistema (con ícono)',
      await evaluate(`['Claro','Oscuro','Sistema'].every((l) => !!document.querySelector('button[aria-label="Modo ' + l + '"]'))`),
    );
    check(
      'el modo activo se resalta (aria-pressed)',
      await evaluate(`document.querySelector('button[aria-label="Modo Oscuro"]')?.getAttribute('aria-pressed') === 'true'`),
    );

    // ── Ámbar + Claro ────────────────────────────────────────────────────────
    await evaluate(CLICK_MODE('Claro'));
    await sleep(300);
    const amberLight = await evaluate(STATE);
    check('modo Claro sobre ámbar', amberLight.theme === 'amber' && amberLight.mode === 'light', `${amberLight.theme}/${amberLight.mode}`);
    check('el fondo cambia a claro', amberLight.bg === BG.light, amberLight.bg);
    const shotLight = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-theme-light.png', Buffer.from(shotLight.data, 'base64'));

    // ── Persistencia ─────────────────────────────────────────────────────────
    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('button[aria-label="Opciones del usuario"]')`)) break;
      await sleep(300);
    }
    const afterReload = await evaluate(STATE);
    check(
      'la elección persiste tras recargar',
      afterReload.theme === 'amber' && afterReload.mode === 'light' && afterReload.bg === BG.light,
      `${afterReload.theme}/${afterReload.mode} ${afterReload.bg}`,
    );

    // ── Azul + Oscuro (color y modo independientes) ──────────────────────────
    await evaluate(`document.querySelector('button[aria-label="Opciones del usuario"]').click()`);
    await sleep(250);
    await evaluate(CLICK_COLOR('Azul'));
    await sleep(300);
    const blueLight = await evaluate(STATE);
    check('Azul conserva el modo actual', blueLight.theme === 'blue' && blueLight.mode === 'light', `${blueLight.theme}/${blueLight.mode}`);
    await evaluate(CLICK_MODE('Oscuro'));
    await sleep(300);
    const blueDark = await evaluate(STATE);
    check('Azul + Oscuro aplica tema azul oscuro', blueDark.theme === 'blue' && blueDark.mode === 'dark', `${blueDark.theme}/${blueDark.mode}`);
    check('el fondo es el azul oscuro', blueDark.bg === BG.blue, blueDark.bg);
    const shotBlue = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-theme-blue.png', Buffer.from(shotBlue.data, 'base64'));

    // ── Vuelve a Ámbar/Oscuro para dejar el panel como estaba ────────────────
    await evaluate(CLICK_COLOR('Ámbar'));
    await sleep(300);
    const back = await evaluate(STATE);
    check('vuelve a Ámbar oscuro', back.theme === 'amber' && back.mode === 'dark' && back.bg === BG.amber, `${back.theme}/${back.mode} ${back.bg}`);
    const shotDark = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-theme-dark.png', Buffer.from(shotDark.data, 'base64'));

    // ── Modo Sistema: sigue la preferencia del SO ────────────────────────────
    // El menú del usuario sigue abierto desde el paso anterior.
    await evaluate(CLICK_MODE('Sistema'));
    await sleep(300);
    const sys = await evaluate(`(() => ({
      mode: document.documentElement.dataset.mode,
      stored: localStorage.getItem('picking-admin-theme'),
      pref: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    }))()`);
    check('modo Sistema resuelve al modo del SO', sys.mode === sys.pref, `${sys.mode} vs SO ${sys.pref}`);
    check('la preferencia "system" se persiste', /:system$/.test(sys.stored || ''), sys.stored);

    // Cambio de preferencia del SO en vivo → el panel debe seguirlo sin recargar.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await sleep(300);
    const sysLight = await evaluate(`document.documentElement.dataset.mode`);
    check('Sistema sigue el cambio del SO a claro', sysLight === 'light', sysLight);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(300);
    const sysDark = await evaluate(`document.documentElement.dataset.mode`);
    check('Sistema sigue el cambio del SO a oscuro', sysDark === 'dark', sysDark);

    console.log('\n  capturas: scripts-agent/.scratch/picking-admin-theme-light.png, -blue.png, -dark.png');
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
