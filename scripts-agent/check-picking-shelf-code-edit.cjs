/**
 * Verifica la edición de una estantería desde el tab Estanterías:
 *   - Cada tarjeta tiene un botón "Editar" visible.
 *   - El modal permite editar el CÓDIGO, pero al cambiarlo pide confirmación.
 *   - Cancelar la confirmación no guarda; confirmar sí persiste (contrastado por API).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-shelf-code-edit.cjs
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
const DEBUG_PORT = 9365;
const ADMIN = { username: 'qa-shelfedit-admin', password: 'qa-shelfedit-1234' };
const CODE = 'QAEDIT1';
const CODE2 = 'QAEDIT2';
const NAME = 'QA Editar';

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

// Input de código dentro del modal (placeholder "A1").
const CODE_INPUT = `[...document.querySelectorAll('input')].find((i) => i.placeholder === 'A1')`;
const SET_INPUT = (value) => `(() => {
  const i = ${CODE_INPUT};
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
const CLICK_TEXT = (text, last = false) => `(() => {
  const all = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === ${JSON.stringify(text)});
  const b = ${last ? 'all[all.length - 1]' : 'all[0]'};
  b?.click(); return !!b;
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
     VALUES ($1, $2, $3, 'Qa', 'ShelfEdit', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  const branches = await (await fetch(`${API}/picking-admin/branches`)).json();
  const branch = branches[0];

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
  const codeOf = async (id) => (await list()).find((s) => s.id === id)?.code ?? null;

  const created = await (
    await fetch(`${API}/picking-admin/shelves`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ branchId: branch.id, code: CODE, name: NAME, type: 'center', posX: 2, posY: 2 }),
    })
  ).json();
  const createdId = created?.id ?? null;

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-shelfedit-${Date.now()}`, 'about:blank',
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
      require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
      require('node:fs').writeFileSync(`scripts-agent/.scratch/${name}.png`, Buffer.from(s.data, 'base64'));
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

    // ── 1. Botón "Editar" visible en la tarjeta ────────────────────────────────
    console.log('\n== Botón Editar en la tarjeta ==');
    check(
      'la tarjeta tiene un botón "Editar"',
      await evaluate(`!!document.querySelector('button[aria-label=${JSON.stringify(`Editar ${CODE}`)}]')`),
    );
    check(
      'el botón "Editar" muestra la etiqueta',
      await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(`Editar ${CODE}`)}]')?.textContent.trim() === 'Editar'`),
    );

    // ── 2. El modal permite editar el código ───────────────────────────────────
    console.log('\n== Modal de edición ==');
    await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(`Editar ${CODE}`)}]').click()`);
    await sleep(400);
    check('se abre el modal "Editar ' + CODE + '"', await evaluate(`document.body.innerText.includes(${JSON.stringify(`Editar ${CODE}`)})`));
    const codeValue = await evaluate(`(() => { const i = ${CODE_INPUT}; return i ? { value: i.value, readOnly: i.readOnly, disabled: i.disabled } : null; })()`);
    check('el código viene precargado y editable', !!codeValue && codeValue.value === CODE && !codeValue.readOnly && !codeValue.disabled, JSON.stringify(codeValue));

    // ── 3. Al cambiar el código pide confirmación ──────────────────────────────
    console.log('\n== Confirmación al cambiar el código ==');
    await evaluate(SET_INPUT(CODE2));
    await sleep(150);
    await evaluate(CLICK_TEXT('Guardar cambios'));
    await sleep(350);
    check('aparece la confirmación "Cambiar código"', await evaluate(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Cambiar código')`));
    check(
      'la confirmación menciona el código viejo y el nuevo',
      await evaluate(`document.body.innerText.includes(${JSON.stringify(CODE)}) && document.body.innerText.includes(${JSON.stringify(CODE2)})`),
    );
    await shot('picking-shelf-code-confirm');

    // Cancelar: no debe guardar.
    await evaluate(CLICK_TEXT('Cancelar', true));
    await sleep(400);
    check('cancelar cierra la confirmación', !(await evaluate(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Cambiar código')`)));
    check('cancelar no cambia el código (sigue en BD)', (await codeOf(createdId)) === CODE, await codeOf(createdId));

    // ── 4. Confirmar persiste el nuevo código ──────────────────────────────────
    await evaluate(CLICK_TEXT('Guardar cambios'));
    await sleep(300);
    await evaluate(CLICK_TEXT('Cambiar código'));
    for (let i = 0; i < 40; i++) {
      if ((await codeOf(createdId)) === CODE2) break;
      await sleep(300);
    }
    check('al confirmar se guarda el nuevo código en BD', (await codeOf(createdId)) === CODE2, await codeOf(createdId));
    check('la tarjeta muestra el nuevo código', await evaluate(`document.body.innerText.includes(${JSON.stringify(CODE2)})`));
  } finally {
    chrome?.kill('SIGKILL');
    if (createdId != null) {
      await fetch(`${API}/picking-admin/shelves/${createdId}`, { method: 'DELETE', headers: auth }).catch(() => undefined);
    }
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    const left = await list();
    check('estado limpio', !left.some((s) => s.id === createdId), `${left.length} estanterías`);
    await db.end();
    console.log('\n  captura: scripts-agent/.scratch/picking-shelf-code-confirm.png');
    console.log('\n  limpieza: estantería y admin temporales eliminados');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
