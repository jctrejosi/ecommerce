/**
 * Verifica el nuevo modelo "producto → categoría → estantería":
 *   - GET /picking-admin/products devuelve `categories` y `shelves` (derivadas)
 *     y ya NO expone shelfId/shelfCode/shelfName.
 *   - Las estanterías devueltas son las de las categorías del producto, en la
 *     sucursal activa (se contrasta contra la BD).
 *   - La pestaña Productos es informativa: sin "Asignación masiva" ni
 *     "Solo sin ubicación".
 *   - La pestaña Categorías ya no tiene el "Mover a" por producto.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-products-informative.cjs
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
const DEBUG_PORT = 9348;
const ADMIN = { username: 'qa-prod-admin', password: 'qa-prod-1234' };
const BRANCH = 9;

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

const clickTabByText = (label) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
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
     VALUES ($1, $2, $3, 'Qa', 'Prod', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  const login = await (
    await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: ADMIN.username, password: ADMIN.password }),
    })
  ).json();
  const auth = { authorization: `Bearer ${login.accessToken}` };

  const products = await (
    await fetch(`${API}/picking-admin/products?branchId=${BRANCH}`, { headers: auth })
  ).json();

  // ── Forma del payload ──────────────────────────────────────────────────────
  check('el endpoint devuelve productos', Array.isArray(products) && products.length > 0, `${products?.length ?? 0}`);
  check(
    'cada producto trae categories[] y shelves[]',
    products.every((p) => Array.isArray(p.categories) && Array.isArray(p.shelves)),
  );
  check(
    'ya no expone shelfId/shelfCode/shelfName',
    products.every((p) => !('shelfId' in p) && !('shelfCode' in p) && !('shelfName' in p)),
  );

  // ── Contraste de la derivación contra la BD ────────────────────────────────
  // Estanterías de la sucursal con sus categorías.
  const { rows: shelfRows } = await db.query(
    `SELECT sc.shelf_id, sc.category_id FROM shelf_categories sc
       JOIN shelves s ON s.id = sc.shelf_id WHERE s.branch_id = $1`,
    [BRANCH],
  );
  const catsOfShelf = new Map();
  for (const r of shelfRows) {
    const id = Number(r.shelf_id);
    const list = catsOfShelf.get(id) ?? new Set();
    list.add(Number(r.category_id));
    catsOfShelf.set(id, list);
  }

  const withShelves = products.find((p) => p.shelves.length > 0);
  check('hay productos que derivan estantería', !!withShelves, withShelves ? withShelves.productName : 'ninguno');

  if (withShelves) {
    const catIds = new Set(withShelves.categories.map((c) => c.id));
    const ok = withShelves.shelves.every((s) => {
      const cats = catsOfShelf.get(s.id);
      if (!cats) return false; // estantería de otra sucursal
      return [...cats].some((cid) => catIds.has(cid)); // ligada a una categoría del producto
    });
    check(
      'las estanterías derivan de las categorías del producto',
      ok,
      `${withShelves.shelves.map((s) => s.code).join(', ')} ← ${withShelves.categories.map((c) => c.name).join(', ')}`,
    );
  }

  // Sin categoría ⇒ sin estantería.
  const noCats = products.find((p) => p.categories.length === 0);
  check(
    'producto sin categoría no deriva estantería',
    !noCats || noCats.shelves.length === 0,
    noCats ? noCats.productName : 'no hay productos sin categoría',
  );

  // Nombre de un producto de una categoría con estantería (para probar la UI).
  const { rows: sample } = await db.query(
    `SELECT p.name FROM products p
       JOIN product_categories pc ON pc.product_id = p.id
      WHERE pc.category_id = 2165 LIMIT 1`,
  );
  const sampleName = sample[0]?.name ?? '';

  // ── UI ─────────────────────────────────────────────────────────────────────
  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-prodinfo-${Date.now()}`, 'about:blank',
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
      if (await evaluate(`/Estanterías|estanterías en/.test(document.body.innerText)`)) break;
      await sleep(300);
    }

    // ── Pestaña Productos ────────────────────────────────────────────────────
    await evaluate(clickTabByText('Productos'));
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`/producto\\(s\\)/.test(document.body.innerText)`)) break;
      await sleep(300);
    }
    const prodText = await evaluate(`document.body.innerText`);
    check('Productos: sin "Asignación masiva"', !/Asignación masiva/.test(prodText));
    check('Productos: sin "Solo sin ubicación"', !/Solo sin ubicación/.test(prodText));
    check('Productos: es informativo (menciona la categoría)', /la ubicación de un producto es la de su categoría/i.test(prodText));

    // Buscar un producto conocido de una categoría con estantería.
    if (sampleName) {
      await evaluate(`(() => {
        const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('Buscar producto'));
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(sampleName)}); input.dispatchEvent(new Event('input', { bubbles: true }));
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Buscar');
        b.click(); return true;
      })()`);
      for (let i = 0; i < 40; i++) {
        if (await evaluate(`document.body.innerText.includes(${JSON.stringify(sampleName)})`)) break;
        await sleep(300);
      }
      const found = await evaluate(`(() => {
        const t = document.body.innerText;
        return { hasCat: /ACCESORIOS HOGAR/.test(t), hasShelf: /DEMO-2/.test(t) };
      })()`);
      check('la tarjeta muestra la categoría del producto', found.hasCat);
      check('la tarjeta muestra la estantería derivada (DEMO-2)', found.hasShelf);
    }

    // Captura con la lista completa (varias tarjetas con categoría y estantería).
    await evaluate(`(() => {
      const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('Buscar producto'));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Buscar');
      b.click(); return true;
    })()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`/producto\(s\)/.test(document.body.innerText)`)) break;
      await sleep(300);
    }
    const shotProd = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-products-informative.png',
      Buffer.from(shotProd.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-products-informative.png');

    // ── Pestaña Categorías ───────────────────────────────────────────────────
    await evaluate(clickTabByText('Categorías'));
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`/Buscar categoría/.test(document.body.innerText)`)) break;
      await sleep(300);
    }
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('ACCESORIOS HOGAR'));
      b?.click(); return !!b;
    })()`);
    await sleep(1200);
    const catNow = await evaluate(`document.body.innerText`);
    check('Categorías: sin "Mover a" por producto', !/Mover a/.test(catNow));
    check('Categorías: sin "Ubicación actual" por producto', !/Ubicación actual/.test(catNow));
    check('Categorías: conserva la asignación de estantería', /estanter[ií]as de esta categor[ií]a/i.test(catNow));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-categories-informative.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-categories-informative.png');
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
