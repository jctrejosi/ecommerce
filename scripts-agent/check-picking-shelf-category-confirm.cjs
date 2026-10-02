/**
 * Verifica las confirmaciones al asociar/quitar categorías de una estantería:
 *   1. Quitar una categoría YA guardada pide confirmación (modal "Quitar categoría").
 *   2. Añadir una categoría que ya vive en OTRA estantería avisa
 *      ("Categoría ya asignada") y, al confirmar, la deja en ambas (N:M permitido).
 * Se comprueba en los dos puntos de edición: pestaña Estanterías y editor de mapa.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-shelf-category-confirm.cjs
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
const DEBUG_PORT = 9367;
const ADMIN = { username: 'qa-catconfirm-admin', password: 'qa-catconfirm-1234' };
const SHELF_A = 'DEMO-1'; // estantería que editamos
const SHELF_B = 'DEMO-2'; // estantería donde ya vive la categoría a duplicar

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

// Cambia el valor de un input de React y dispara el evento.
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

  const branches = await (await fetch(`${API}/picking-admin/branches`)).json();
  const branch = branches[0];
  const shelvesBefore = await (
    await fetch(`${API}/picking-admin/shelves?branchId=${branch.id}`)
  ).json();
  const shelfA = shelvesBefore.find((s) => s.code === SHELF_A);
  const shelfB = shelvesBefore.find((s) => s.code === SHELF_B);
  if (!shelfA || !shelfB) throw new Error(`No se encontraron ${SHELF_A}/${SHELF_B} en la sucursal`);

  // Categoría ya guardada en A (para probar la confirmación al quitarla).
  const catA = shelfA.categories[0];
  if (!catA) throw new Error(`${SHELF_A} no tiene categorías guardadas para la prueba`);

  // Categoría libre: se la asignamos a B para simular "ya tiene estantería".
  const assigned = await db.query('SELECT category_id FROM shelf_categories');
  const assignedIds = new Set(assigned.rows.map((r) => Number(r.category_id)));
  const allCats = await (await fetch(`${API}/picking-admin/categories`)).json();
  const OTHER = allCats.find((c) => !assignedIds.has(c.id));
  if (!OTHER) throw new Error('No hay categorías libres para la prueba');

  // Estado original de A y B, para restaurar.
  const origCats = {};
  for (const id of [shelfA.id, shelfB.id]) {
    const r = await db.query('SELECT category_id FROM shelf_categories WHERE shelf_id = $1', [id]);
    origCats[id] = r.rows.map((x) => Number(x.category_id));
  }
  console.log(`${SHELF_A}(${shelfA.id}) cats:`, JSON.stringify(origCats[shelfA.id]));
  console.log(`${SHELF_B}(${shelfB.id}) cats:`, JSON.stringify(origCats[shelfB.id]));
  console.log(`categoría guardada en A: ${catA.name} (${catA.id}) · categoría a duplicar: ${OTHER.name} (${OTHER.id})`);

  // OTHER vive sólo en B al empezar.
  await db.query('INSERT INTO shelf_categories (shelf_id, category_id) VALUES ($1, $2)', [
    shelfB.id,
    OTHER.id,
  ]);

  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'CatConfirm', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-catconfirm-${Date.now()}`, 'about:blank',
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
    const clickAt = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    };

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

    const overlayText = () => evaluate(`(() => {
      const o = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/70'));
      return o ? o.innerText : null;
    })()`);
    const clickOverlayBtn = (text) => evaluate(`(() => {
      const o = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/70'));
      const b = o ? [...o.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}) : null;
      b?.click(); return !!b;
    })()`);
    const openShelfEditor = async () => {
      await evaluate(`(() => {
        const card = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-surface') && d.querySelector('h3')?.textContent.includes(${JSON.stringify(SHELF_A)}));
        const b = card ? [...card.querySelectorAll('button')].find((x) => x.title === 'Editar') : null;
        b?.click(); return !!b;
      })()`);
      for (let i = 0; i < 40; i++) {
        if (await evaluate(`document.body.innerText.includes('Editar ${SHELF_A}')`)) break;
        await sleep(200);
      }
    };

    // ── 1. Estanterías: quitar una categoría guardada pide confirmación ────
    console.log('\n== Estanterías: quitar categoría guardada ==');
    await openShelfEditor();
    check('se abrió el editor de ' + SHELF_A, await evaluate(`document.body.innerText.includes('Editar ${SHELF_A}')`));
    const chipBefore = await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(catA.name)}) && b.textContent.trim().endsWith('×'))`);
    check('la categoría ya guardada aparece como chip', chipBefore === true);

    // Filtra por esa categoría y pulsa su fila.
    await evaluate(`(() => { ${SET_INPUT}
      const input = document.querySelector('input[placeholder="Buscar categoría…"]');
      setValue(input, ${JSON.stringify(catA.name)});
      return true;
    })()`);
    await sleep(250);
    const rowClicked = await evaluate(`(() => {
      const list = document.querySelector('div[class*="max-h-44"]');
      const b = list ? [...list.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(catA.name)}) : null;
      b?.click(); return !!b;
    })()`);
    check('se puede pulsar la categoría guardada', rowClicked === true);
    await sleep(250);
    const removeOverlay = await overlayText();
    check('pide confirmación al quitar ("Quitar categoría")', !!removeOverlay && removeOverlay.includes('Quitar categoría'), removeOverlay ? 'ok' : 'sin overlay');
    check('el aviso nombra la categoría', !!removeOverlay && removeOverlay.includes(catA.name));
    {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
      require('node:fs').writeFileSync('scripts-agent/.scratch/picking-shelf-cat-remove-confirm.png', Buffer.from(s.data, 'base64'));
    }
    await clickOverlayBtn('Cancelar');
    await sleep(250);
    const chipAfterCancel = await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(catA.name)}) && b.textContent.trim().endsWith('×'))`);
    check('al cancelar la categoría sigue marcada', chipAfterCancel === true);

    // ── 2. Estanterías: añadir una categoría de otra estantería avisa ──────
    console.log('\n== Estanterías: categoría ya asignada en otra ==');
    await evaluate(`(() => { ${SET_INPUT}
      const input = document.querySelector('input[placeholder="Buscar categoría…"]');
      setValue(input, ${JSON.stringify(OTHER.name)});
      return true;
    })()`);
    await sleep(250);
    const otherNotSelected = await evaluate(`![...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(OTHER.name)}) && b.textContent.trim().endsWith('×'))`);
    check(`${OTHER.name} aún no está en ${SHELF_A}`, otherNotSelected === true);
    const otherRowClicked = await evaluate(`(() => {
      const list = document.querySelector('div[class*="max-h-44"]');
      const b = list ? [...list.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(OTHER.name)}) : null;
      b?.click(); return !!b;
    })()`);
    check('se puede pulsar la categoría candidata', otherRowClicked === true);
    await sleep(250);
    const addOverlay = await overlayText();
    check('avisa que ya tiene estantería ("Categoría ya asignada")', !!addOverlay && addOverlay.includes('Categoría ya asignada'), addOverlay ? 'ok' : 'sin overlay');
    check('el aviso menciona la otra estantería', !!addOverlay && addOverlay.includes(SHELF_B), addOverlay || '');
    {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').writeFileSync('scripts-agent/.scratch/picking-shelf-cat-move-confirm.png', Buffer.from(s.data, 'base64'));
    }
    await clickOverlayBtn('Cancelar');
    await sleep(250);
    const stillNot = await evaluate(`![...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(OTHER.name)}) && b.textContent.trim().endsWith('×'))`);
    check('al cancelar no se asigna', stillNot === true);

    // Reintenta y confirma: queda marcada.
    await evaluate(`(() => {
      const list = document.querySelector('div[class*="max-h-44"]');
      const b = list ? [...list.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(OTHER.name)}) : null;
      b?.click(); return !!b;
    })()`);
    await sleep(250);
    await clickOverlayBtn('Asignar igualmente');
    await sleep(250);
    const nowMarked = await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(OTHER.name)}) && b.textContent.trim().endsWith('×'))`);
    check('al confirmar la categoría queda marcada', nowMarked === true);

    // Guarda y contrasta con la BD/API.
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Guardar cambios'));
      b?.click(); return !!b;
    })()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`!document.body.innerText.includes('Editar ${SHELF_A}')`)) break;
      await sleep(250);
    }
    const shelvesAfter = await (
      await fetch(`${API}/picking-admin/shelves?branchId=${branch.id}`)
    ).json();
    const aAfter = shelvesAfter.find((s) => s.id === shelfA.id);
    const bAfter = shelvesAfter.find((s) => s.id === shelfB.id);
    check(`${SHELF_A} quedó con ${OTHER.name}`, aAfter.categories.some((c) => c.id === OTHER.id));
    check(`${SHELF_B} conserva ${OTHER.name} (N:M permitido)`, bAfter.categories.some((c) => c.id === OTHER.id));
    check(`${SHELF_A} mantiene ${catA.name}`, aAfter.categories.some((c) => c.id === catA.id));

    // ── 3. Editor de mapa: misma confirmación al quitar ────────────────────
    console.log('\n== Editor de mapa: quitar categoría guardada ==');
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Mapa'); b?.click(); return true; })()`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`!!document.querySelector('#map-preview')`)) break;
      await sleep(250);
    }
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Editar mapa')); b?.click(); return true; })()`);
    await sleep(400);
    const shelfRect = await evaluate(`(() => {
      const label = [...document.querySelectorAll('#map-canvas span')].find((s) => s.textContent.trim() === ${JSON.stringify(SHELF_A)});
      if (!label) return null;
      const r = label.parentElement.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    check('se encontró ' + SHELF_A + ' en el mapa', !!shelfRect);
    await clickAt(shelfRect.x, shelfRect.y);
    await sleep(300);
    const editContent = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#map-canvas button')].find((x) => x.textContent.includes('Editar contenido'));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (editContent) await clickAt(editContent.x, editContent.y);
    await sleep(400);
    check('se abre el modal de contenido', await evaluate(`document.body.innerText.includes('Contenido de ${SHELF_A}')`));
    await evaluate(`(() => { ${SET_INPUT}
      const input = document.querySelector('input[placeholder="Buscar categoría…"]');
      setValue(input, ${JSON.stringify(catA.name)});
      return true;
    })()`);
    await sleep(250);
    const mapRow = await evaluate(`(() => {
      const list = document.querySelector('div[class*="max-h-64"]');
      const b = list ? [...list.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(catA.name)}) : null;
      b?.click(); return !!b;
    })()`);
    check('se puede pulsar la categoría guardada en el mapa', mapRow === true);
    await sleep(250);
    const mapOverlay = await overlayText();
    check('el mapa también pide confirmación al quitar', !!mapOverlay && mapOverlay.includes('Quitar categoría'), mapOverlay ? 'ok' : 'sin overlay');
    await clickOverlayBtn('Cancelar');
    await sleep(200);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

    console.log('\n  capturas: scripts-agent/.scratch/picking-shelf-cat-remove-confirm.png, -move-confirm.png');
  } finally {
    chrome?.kill('SIGKILL');
    // Restaura las categorías originales de A y B.
    for (const id of [shelfA.id, shelfB.id]) {
      await db.query('DELETE FROM shelf_categories WHERE shelf_id = $1', [id]);
      for (const cid of origCats[id]) {
        await db.query('INSERT INTO shelf_categories (shelf_id, category_id) VALUES ($1, $2)', [id, cid]);
      }
    }
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
    console.log('\n  limpieza: categorías de A y B restauradas y admin temporal eliminado');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
