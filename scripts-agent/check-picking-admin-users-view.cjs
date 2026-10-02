/**
 * Verifica la visualización de usuarios en el picking admin:
 *   1. Conmutador en la parte superior (Tarjetas ↔ Lista).
 *   2. Vista de tarjetas: grid (kanban) sin tabla.
 *   3. Vista de lista: tabla con las columnas de estado en vivo.
 *   4. La preferencia se recuerda (localStorage).
 *   5. Las acciones (p. ej. cambiar contraseña) siguen funcionando en la tabla.
 *   6. El buscador filtra en ambos modos.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-users-view.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9369;
const ADMIN = { username: 'qa-usersview-admin', password: 'qa-usersview-1234' };
const VIEW_KEY = 'picking-admin:users-view';

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

const SET_INPUT = `
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };`;

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
     VALUES ($1, $2, $3, 'Qa', 'UsersView', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1500,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-usersview-${Date.now()}`, 'about:blank',
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
    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
      require('node:fs').writeFileSync(`scripts-agent/.scratch/${name}`, Buffer.from(s.data, 'base64'));
    };
    const clickByTitle = (title) => evaluate(`(() => {
      const b = document.querySelector('button[title=${JSON.stringify(title)}]');
      b?.click(); return !!b;
    })()`);

    // ── Login ──────────────────────────────────────────────────────────────
    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('form input')`)) break;
      await sleep(250);
    }
    await evaluate(`(() => { ${SET_INPUT}
      const [user, pass] = document.querySelectorAll('form input');
      setValue(user, ${JSON.stringify(ADMIN.username)});
      setValue(pass, ${JSON.stringify(ADMIN.password)});
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`/estanterías en/.test(document.body.innerText)`)) break;
      await sleep(300);
    }

    // Pestaña Usuarios.
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Usuarios');
      b?.click(); return !!b;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('button[title="Ver como lista"]') && /estado en vivo de los pickers/i.test(document.body.innerText)`)) break;
      await sleep(300);
    }

    // ── 1. Conmutador y vista por defecto (tarjetas) ───────────────────────
    console.log('\n== Conmutador de vista ==');
    check('existe el botón "Tarjetas"', await evaluate(`!!document.querySelector('button[title="Ver como tarjetas"]')`));
    check('existe el botón "Lista"', await evaluate(`!!document.querySelector('button[title="Ver como lista"]')`));
    const cardsDefault = await evaluate(`({
      pressed: document.querySelector('button[title="Ver como tarjetas"]')?.getAttribute('aria-pressed'),
      hasTable: !!document.querySelector('table'),
      stored: localStorage.getItem(${JSON.stringify(VIEW_KEY)}),
    })`);
    check('arranca en vista de tarjetas', cardsDefault.pressed === 'true', JSON.stringify(cardsDefault));
    check('en tarjetas no hay tabla', cardsDefault.hasTable === false);
    check('el header está por encima de la lista', await evaluate(`(() => {
      const g = document.querySelector('button[title="Ver como lista"]');
      const first = document.querySelector('main div[class*="bg-surface-alt"], main table');
      return !!g && !!first && g.getBoundingClientRect().top < first.getBoundingClientRect().top;
    })()`));
    await shot('picking-admin-users-cards.png');

    // ── 2. Cambiar a lista ─────────────────────────────────────────────────
    console.log('\n== Vista de lista ==');
    await clickByTitle('Ver como lista');
    await sleep(400);
    const tableInfo = await evaluate(`(() => {
      const t = document.querySelector('table');
      if (!t) return null;
      return {
        headers: [...t.querySelectorAll('thead th')].map((h) => h.innerText.trim()),
        rows: t.querySelectorAll('tbody tr').length,
        stored: localStorage.getItem(${JSON.stringify(VIEW_KEY)}),
        pressedLista: document.querySelector('button[title="Ver como lista"]')?.getAttribute('aria-pressed'),
      };
    })()`);
    check('se muestra la tabla', !!tableInfo);
    check('la tabla tiene filas', !!tableInfo && tableInfo.rows > 0, tableInfo ? `${tableInfo.rows} filas` : '');
    const hs = (tableInfo?.headers ?? []).join(' | ').toLowerCase();
    check('columna "Usuario"', hs.includes('usuario'));
    check('columna "Rol"', hs.includes('rol'));
    check('columna "Estado"', hs.includes('estado'));
    check('columna "Pedido en curso"', hs.includes('pedido en curso'));
    check('columna "Avance"', hs.includes('avance'));
    check('columnas "Hoy" y "Total"', hs.includes('hoy') && hs.includes('total'));
    check('columna "Acciones"', hs.includes('acciones'));
    check('el botón "Lista" queda activo', tableInfo?.pressedLista === 'true');
    check('la preferencia se guarda (localStorage)', tableInfo?.stored === 'table', tableInfo?.stored ?? 'null');
    await shot('picking-admin-users-table.png');

    // ── 3. Buscador filtra en la tabla ─────────────────────────────────────
    console.log('\n== Buscador en lista ==');
    const allRows = tableInfo.rows;
    await evaluate(`(() => { ${SET_INPUT}
      const input = document.querySelector('input[placeholder^="Buscar por"]');
      setValue(input, 'qa-usersview');
      return true;
    })()`);
    await sleep(350);
    const filteredRows = await evaluate(`document.querySelectorAll('table tbody tr').length`);
    check('el buscador reduce a la coincidencia', filteredRows === 1, `${filteredRows} de ${allRows}`);
    await evaluate(`(() => { ${SET_INPUT}
      const input = document.querySelector('input[placeholder^="Buscar por"]');
      setValue(input, '');
      return true;
    })()`);
    await sleep(350);

    // ── 4. Acción desde la tabla (cambiar contraseña) ──────────────────────
    console.log('\n== Acciones en la tabla ==');
    const resetClicked = await evaluate(`(() => {
      const b = document.querySelector('table tbody button[title="Cambiar contraseña"]');
      b?.click(); return !!b;
    })()`);
    check('hay acción "Cambiar contraseña" en la fila', resetClicked === true);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`document.body.innerText.includes('Cambiar contraseña') && !!document.querySelector('input[placeholder="Nueva contraseña"]')`)) break;
      await sleep(200);
    }
    check('la acción abre el modal de contraseña', await evaluate(`!!document.querySelector('input[placeholder="Nueva contraseña"]')`));
    await evaluate(`(() => {
      const b = document.querySelector('button[title="Cerrar"]');
      b?.click(); return !!b;
    })()`);
    await sleep(300);

    // ── 5. Volver a tarjetas ───────────────────────────────────────────────
    console.log('\n== Volver a tarjetas ==');
    await clickByTitle('Ver como tarjetas');
    await sleep(350);
    const back = await evaluate(`({
      hasTable: !!document.querySelector('table'),
      stored: localStorage.getItem(${JSON.stringify(VIEW_KEY)}),
    })`);
    check('la tabla desaparece', back.hasTable === false);
    check('la preferencia vuelve a "cards"', back.stored === 'cards', back.stored ?? 'null');

    console.log('\n  capturas: scripts-agent/.scratch/picking-admin-users-cards.png, -table.png');
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
