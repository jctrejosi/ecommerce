/**
 * Verifica el modal de confirmación para eliminar estanterías:
 *   - Al pulsar el botón de eliminar se abre un modal (ya no un confirm()).
 *   - El modal exige teclear el nombre de la estantería.
 *   - El botón "Eliminar" está deshabilitado hasta que el texto coincide.
 *   - "Cancelar" cierra sin borrar (se contrasta por API).
 *   - El camino feliz borra de verdad (se contrasta por API).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-shelf-delete-modal.cjs
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

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9346;
const ADMIN = { username: 'qa-shelfdel-admin', password: 'qa-shelfdel-1234' };
const CODE = 'QADEL1';
const NAME = 'QA Borrar';

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

// Devuelve la tarjeta de estantería cuyo <h3> contiene el código dado.
const CARD_FOR = (code) => `(() => {
  const h = [...document.querySelectorAll('h3')].find((el) => el.innerText.includes(${JSON.stringify(code)}));
  if (!h) return null;
  let el = h;
  while (el && !el.querySelector('button[title="Eliminar"]')) el = el.parentElement;
  return el;
})()`;

// Texto del botón "Eliminar" del modal y si está deshabilitado.
const MODAL_BTN = `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^Eliminar$/.test(x.textContent.trim()));
  return b ? { disabled: b.disabled } : null;
})()`;

async function main() {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'ShelfDel', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  const branches = await (await fetch(`${API}/picking-admin/branches`)).json();
  const branch = branches[0];

  // Token por API para crear/consultar/limpiar la estantería de prueba.
  const login = await (
    await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: ADMIN.username, password: ADMIN.password }),
    })
  ).json();
  const auth = { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' };

  const list = async () =>
    (await fetch(`${API}/picking-admin/shelves?branchId=${branch.id}`, { headers: auth })).json();

  // Estantería desechable para probar el borrado real.
  const created = await (
    await fetch(`${API}/picking-admin/shelves`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ branchId: branch.id, code: CODE, name: NAME, type: 'center', posX: 1, posY: 1 }),
    })
  ).json();
  const createdId = created?.id ?? null;
  const before = await list();

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-shelfdel-${Date.now()}`, 'about:blank',
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
      if (await evaluate(`/estanterías en/.test(document.body.innerText)`)) break;
      await sleep(300);
    }

    // ── El botón abre un MODAL (no un confirm nativo) ─────────────────────────
    await evaluate(`${CARD_FOR(CODE)}.querySelector('button[title="Eliminar"]').click()`);
    await sleep(400);
    const opened = await evaluate(`(() => ({
      title: document.body.innerText.includes('Eliminar estantería'),
      hasInput: !!([...document.querySelectorAll('input')].find((i) => i.placeholder === ${JSON.stringify(NAME)})),
      confirmBtn: ${MODAL_BTN},
    }))()`);
    check('se abre el modal de eliminación', opened.title, `title=${opened.title}`);
    check('el modal pide teclear el nombre', opened.hasInput, `input=${opened.hasInput}`);
    check('el botón Eliminar arranca deshabilitado', opened.confirmBtn?.disabled === true, JSON.stringify(opened.confirmBtn));

    // ── Texto incorrecto: sigue deshabilitado ────────────────────────────────
    await evaluate(`(() => {
      const i = [...document.querySelectorAll('input')].find((x) => x.placeholder === ${JSON.stringify(NAME)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'nombre equivocado'); i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(150);
    check('con texto incorrecto sigue deshabilitado', (await evaluate(MODAL_BTN))?.disabled === true);

    // ── Texto correcto: se habilita ──────────────────────────────────────────
    await evaluate(`(() => {
      const i = [...document.querySelectorAll('input')].find((x) => x.placeholder === ${JSON.stringify(NAME)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(i, ${JSON.stringify(NAME)}); i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(150);
    check('con el nombre exacto se habilita', (await evaluate(MODAL_BTN))?.disabled === false);

    // Captura del modal abierto con el nombre ya escrito.
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-shelf-delete-modal.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-shelf-delete-modal.png');

    // ── Cancelar: no borra nada ──────────────────────────────────────────────
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cancelar');
      b.click(); return true;
    })()`);
    await sleep(400);
    const afterCancel = await list();
    check('Cancelar cierra el modal', !(await evaluate(`document.body.innerText.includes('Eliminar estantería')`)));
    check('Cancelar no borra la estantería', afterCancel.some((s) => s.id === createdId), `${afterCancel.length} estanterías`);

    // ── Camino feliz: confirmar borra de verdad ──────────────────────────────
    await evaluate(`${CARD_FOR(CODE)}.querySelector('button[title="Eliminar"]').click()`);
    await sleep(300);
    await evaluate(`(() => {
      const i = [...document.querySelectorAll('input')].find((x) => x.placeholder === ${JSON.stringify(NAME)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(i, ${JSON.stringify(NAME)}); i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(150);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Eliminar');
      b.click(); return true;
    })()`);
    for (let i = 0; i < 40; i++) {
      if (!(await evaluate(`document.body.innerText.includes(${JSON.stringify(CODE)})`))) break;
      await sleep(300);
    }
    const afterDelete = await list();
    check('al confirmar se elimina la estantería', !afterDelete.some((s) => s.id === createdId), `${afterDelete.length} estanterías`);
    check('la tarjeta desaparece de la lista', !(await evaluate(`document.body.innerText.includes(${JSON.stringify(CODE)})`)));
  } finally {
    chrome?.kill('SIGKILL');
    if (createdId != null) {
      await fetch(`${API}/picking-admin/shelves/${createdId}`, { method: 'DELETE', headers: auth }).catch(() => undefined);
    }
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    const left = await list();
    check('estado limpio', !left.some((s) => s.id === createdId), `${left.length} estanterías (antes ${before.length})`);
    await db.end();
    console.log('\n  limpieza: estantería y admin temporales eliminados');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
