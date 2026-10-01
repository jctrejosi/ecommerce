/**
 * Verifica el buscador de la bandeja de chats del header (picking admin):
 *   - El endpoint /picking-admin/chats expone `username` de cada picker.
 *   - El drawer muestra un input "Buscar picker por nombre o código…".
 *   - Filtrar por usuario (código) deja solo el picker buscado.
 *   - Buscar por nombre también filtra.
 *   - Un texto sin coincidencias muestra el estado vacío.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-chat-search.cjs
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
const DEBUG_PORT = 9347;
const ADMIN = { username: 'qa-chat-admin', password: 'qa-chat-1234' };

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

// Cuenta las filas (botones) de la lista del drawer, partiendo del input de búsqueda.
const DRAWER_ROWS = `(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').startsWith('Buscar picker'));
  if (!input) return { found: false, rows: 0, names: [] };
  const list = input.closest('div.shrink-0')?.nextElementSibling;
  const btns = list ? [...list.querySelectorAll('button')] : [];
  return { found: true, rows: btns.length, names: btns.map((b) => b.innerText) };
})()`;

const TYPE_SEARCH = (value) => `(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').startsWith('Buscar picker'));
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
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
     VALUES ($1, $2, $3, 'Qa', 'ChatAdmin', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  // Login por API para inspeccionar el endpoint.
  const login = await (
    await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: ADMIN.username, password: ADMIN.password }),
    })
  ).json();
  const token = login?.accessToken;
  if (!token) throw new Error('no se pudo iniciar sesión por API');

  const chats = await (
    await fetch(`${API}/picking-admin/chats`, { headers: { authorization: `Bearer ${token}` } })
  ).json();

  check('el endpoint de chats responde una lista', Array.isArray(chats), `${chats?.length ?? 0} pickers`);
  check(
    'cada conversación expone el username (código)',
    chats.length > 0 && chats.every((c) => typeof c.username === 'string' && c.username.length > 0),
    chats[0] ? `ej: @${chats[0].username}` : 'sin pickers',
  );

  // Picker objetivo para buscar (por usuario y por nombre).
  const target = chats.find((c) => c.username !== ADMIN.username) ?? chats[0];
  const targetUser = target.username;
  const targetName = target.fullName;

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-chatsearch-${Date.now()}`, 'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        .then((r) => r.json()).catch(() => null);
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
      if (await evaluate(`!!document.querySelector('button[aria-label="Chat con los pickers"]')`)) break;
      await sleep(300);
    }

    // Abre la bandeja de chat del header.
    await evaluate(`document.querySelector('button[aria-label="Chat con los pickers"]').click()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`/[Bb]uscar picker/.test(document.body.innerText) || !!document.querySelector('input[placeholder^="Buscar picker"]')`)) break;
      await sleep(300);
    }
    // Espera a que carguen las filas.
    for (let i = 0; i < 40; i++) {
      const r = await evaluate(DRAWER_ROWS);
      if (r.found && r.rows > 0) break;
      await sleep(300);
    }

    const before = await evaluate(DRAWER_ROWS);
    check('el drawer tiene el buscador', before.found, `found=${before.found}`);
    check('la bandeja lista pickers', before.rows > 0, `${before.rows} pickers`);

    // ── Filtrar por código (username) ────────────────────────────────────────
    await evaluate(TYPE_SEARCH(targetUser));
    await sleep(400);
    const byUser = await evaluate(DRAWER_ROWS);
    const userHit = byUser.names.some((n) => n.toLowerCase().includes(targetUser.toLowerCase()));
    check('buscar por código deja el picker', userHit, `@${targetUser}`);
    check(
      'buscar por código reduce la lista',
      byUser.rows <= before.rows && byUser.rows >= 1,
      `${before.rows} → ${byUser.rows}`,
    );

    // ── Filtrar por nombre ───────────────────────────────────────────────────
    await evaluate(TYPE_SEARCH(targetName));
    await sleep(400);
    const byName = await evaluate(DRAWER_ROWS);
    check(
      'buscar por nombre encuentra al picker',
      byName.names.some((n) => n.toLowerCase().includes(targetName.toLowerCase())),
      targetName,
    );

    // ── Sin coincidencias ────────────────────────────────────────────────────
    await evaluate(TYPE_SEARCH('zzz-no-existe-999'));
    await sleep(400);
    const none = await evaluate(DRAWER_ROWS);
    check('sin coincidencias muestra estado vacío', none.rows === 0, `${none.rows} filas`);

    // Captura con el filtro por código aplicado.
    await evaluate(TYPE_SEARCH(targetUser));
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-chat-search.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-chat-search.png');
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
