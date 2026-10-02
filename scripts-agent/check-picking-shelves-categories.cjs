/**
 * Verifica el cambio de estanterías: varias categorías y sin filas.
 *   - La tarjeta de estantería muestra categorías (chips) y ya no "N fila(s)".
 *   - El modal (Nueva/Editar) tiene selector múltiple de categorías y NO la
 *     sección "Filas de la estantería".
 *   - Crear una estantería con 2 categorías persiste ambas (se contrasta por API).
 *   - La pestaña Productos ya no ofrece el selector de "Fila…".
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-shelves-categories.cjs
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
const DEBUG_PORT = 9345;
const ADMIN = { username: 'qa-shelfcat-admin', password: 'qa-shelfcat-1234' };
const CODE = 'QATEST1';

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
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'ShelfCat', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  // Sucursal con estanterías demo para mirar una tarjeta.
  const branches = await (await fetch(`${API}/picking-admin/branches`)).json();
  const branch = branches[0];
  const before = await (
    await fetch(`${API}/picking-admin/shelves?branchId=${branch.id}`)
  ).json();

  let createdId = null;
  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-shelfcat-${Date.now()}`, 'about:blank',
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

    // ── Tarjeta: chips de categorías y sin filas ─────────────────────────────
    const card = await evaluate(`(() => {
      const t = document.body.innerText;
      return { filas: /fila\\(s\\)/i.test(t), demo: /DEMO-1/.test(t) };
    })()`);
    check('hay estanterías listadas', card.demo, JSON.stringify(card));
    check('ya no se muestran "N fila(s)"', !card.filas, `filas=${card.filas}`);

    // ── Modal: multi-categoría, sin filas ────────────────────────────────────
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Nueva estantería'));
      b.click(); return true;
    })()`);
    await sleep(400);
    const modal = await evaluate(`(() => {
      const t = document.body.innerText;
      const list = document.querySelector('div[class*="max-h-44"]');
      return {
        hasFilas: /Filas de la estantería/.test(t),
        hasCats: /Categorías/.test(t),
        catButtons: list ? list.querySelectorAll('button').length : 0,
      };
    })()`);
    check('el modal ya no tiene "Filas de la estantería"', !modal.hasFilas, `hasFilas=${modal.hasFilas}`);
    check('el modal tiene selector de Categorías', modal.hasCats, `hasCats=${modal.hasCats}`);
    check('el selector lista varias categorías', modal.catButtons > 1, `${modal.catButtons} categorías`);

    // Elegir 2 categorías + código y crear. Alguna puede vivir ya en otra
    // estantería, así que se confirma el aviso cuando aparezca.
    const clickCategoryRow = async (idx) => {
      await evaluate(`(() => {
        const list = document.querySelector('div[class*="max-h-44"]');
        const btns = [...list.querySelectorAll('button')];
        btns[${idx}].click(); return true;
      })()`);
      await sleep(200);
      await evaluate(`(() => {
        const o = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/70'));
        const b = o ? [...o.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Asignar igualmente') : null;
        b?.click(); return !!b;
      })()`);
      await sleep(150);
    };
    await clickCategoryRow(0);
    await clickCategoryRow(1);
    await evaluate(`(() => {
      const codeInput = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'A1');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(codeInput, ${JSON.stringify(CODE)}); codeInput.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const picked = { selected: await evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim().endsWith('×')).length`) };
    check('se pueden marcar varias categorías', picked.selected === 2, `${picked.selected} marcadas`);

    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Crear estantería'));
      b.click(); return true;
    })()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`document.body.innerText.includes(${JSON.stringify(CODE)}) && !document.body.innerText.includes('Crear estantería')`)) break;
      await sleep(300);
    }

    // ── Contraste por API: la estantería quedó con 2 categorías ───────────────
    const after = await (
      await fetch(`${API}/picking-admin/shelves?branchId=${branch.id}`)
    ).json();
    const created = after.find((s) => s.code === CODE);
    createdId = created?.id ?? null;
    check('la estantería se creó', !!created, createdId ? `id ${createdId}` : 'no encontrada');
    check(
      'quedó asociada a 2 categorías',
      created?.categories?.length === 2,
      `${created?.categories?.length ?? 0} categorías`,
    );

    // ── Productos: sin selector de fila ──────────────────────────────────────
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('main button, nav button, button')].find((x) => x.textContent.trim() === 'Productos');
      b?.click(); return !!b;
    })()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`/producto\\(s\\)/.test(document.body.innerText)`)) break;
      await sleep(300);
    }
    const prod = await evaluate(`(() => ({
      hasFila: document.body.innerText.includes('Fila…'),
      hasShelfSelect: document.body.innerText.includes('Sin estantería'),
    }))()`);
    check('Productos ya no ofrece "Fila…"', !prod.hasFila, `hasFila=${prod.hasFila}`);
    check('Productos mantiene el selector de estantería', prod.hasShelfSelect, `shelf=${prod.hasShelfSelect}`);

    // ── Categorías: organización sin filas ───────────────────────────────────
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('main button, nav button, button')].find((x) => x.textContent.trim() === 'Categorías');
      b?.click(); return !!b;
    })()`);
    await sleep(700);
    const catClicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('ACCESORIOS DEL HOGAR'));
      b?.click(); return !!b;
    })()`);
    check('se abre una categoría en la pestaña Categorías', catClicked);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`document.body.innerText.includes('Estanterías de esta categoría')`)) break;
      await sleep(300);
    }
    const catOrg = await evaluate(`(() => ({
      hasShelf: document.body.innerText.includes('DEMO-'),
      hasFila: /Fila/.test(document.body.innerText),
    }))()`);
    check('la categoría lista sus estanterías', catOrg.hasShelf, `shelf=${catOrg.hasShelf}`);
    check('la organización por categoría ya no usa filas', !catOrg.hasFila, `fila=${catOrg.hasFila}`);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-shelves-categories.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-shelves-categories.png');
  } finally {
    chrome?.kill('SIGKILL');
    if (createdId != null) {
      await fetch(`${API}/picking-admin/shelves/${createdId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    const left = await (await fetch(`${API}/picking-admin/shelves?branchId=${branch.id}`)).json();
    check(
      'estado limpio: sin estanterías de prueba',
      !left.some((s) => s.code === CODE),
      `${left.length} estanterías (antes ${before.length})`,
    );
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
