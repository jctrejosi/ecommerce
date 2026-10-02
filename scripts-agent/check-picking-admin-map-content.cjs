/**
 * Verifica la edición del mapa del picking admin:
 *   1. Botón "Pantalla completa" que deja sólo el mapa (canvas fijo).
 *   2. Al seleccionar una estantería aparece el botón flotante "Editar contenido".
 *   3. Ese botón abre un modal para asociar categorías, y al guardar persiste en BD.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-map-content.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9363;
const ADMIN = { username: 'qa-map-admin', password: 'qa-map-1234' };
// Estantería DEMO-1 de TID Sucursal 1, y una categoría que no tiene asignada.
const SHELF_ID = 2;
const ADD_CATEGORY = { id: 2165, name: 'ACCESORIOS HOGAR' };

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
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  const before = await db.query('SELECT category_id FROM shelf_categories WHERE shelf_id = $1', [SHELF_ID]);
  const originalCats = before.rows.map((r) => Number(r.category_id));
  console.log('Categorías originales de la estantería', SHELF_ID, ':', JSON.stringify(originalCats));

  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Map', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-map-${Date.now()}`, 'about:blank',
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

    // Login
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
      if (await evaluate(`document.body.innerText.includes('Mapa')`)) break;
      await sleep(300);
    }
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Mapa'); b?.click(); return true; })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('#map-preview')`)) break;
      await sleep(300);
    }
    check('la pestaña Mapa muestra la miniatura de la bodega', await evaluate(`!!document.querySelector('#map-preview')`));
    check('el editor aún no está montado', await evaluate(`!document.querySelector('#map-canvas')`));
    {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
      require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-map-thumbnail.png', Buffer.from(s.data, 'base64'));
    }

    // ── 1. Pantalla completa ───────────────────────────────────────────────
    console.log('\n== Pantalla completa ==');
    const hasFullBtn = await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Editar mapa'))`);
    check('existe el botón "Editar mapa"', hasFullBtn === true);
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Editar mapa')); b?.click(); return true; })()`);
    await sleep(400);
    const fixed = await evaluate(`getComputedStyle(document.querySelector('#map-canvas')).position`);
    check('el mapa queda a pantalla completa (position fixed)', fixed === 'fixed', fixed);
    check('aparece la barra con "Mapa de la bodega"', await evaluate(`document.body.innerText.includes('Mapa de la bodega')`));
    check('se puede cerrar con el botón "Cerrar"', await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Cerrar')`));

    // ── 2. Botón flotante al seleccionar una estantería ────────────────────
    console.log('\n== Botón flotante por estantería ==');
    const shelfRect = await evaluate(`(() => {
      const label = [...document.querySelectorAll('#map-canvas span')].find((s) => s.textContent.trim() === 'DEMO-1');
      if (!label) return null;
      const r = label.parentElement.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    check('se encontró la estantería DEMO-1 en el mapa', !!shelfRect, shelfRect ? `(${Math.round(shelfRect.x)}, ${Math.round(shelfRect.y)})` : '');
    const beforeFloating = await evaluate(`[...document.querySelectorAll('#map-canvas button')].some((b) => b.textContent.includes('Editar contenido'))`);
    check('antes de seleccionar no hay botón flotante', beforeFloating === false);
    await clickAt(shelfRect.x, shelfRect.y);
    await sleep(350);
    const floating = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#map-canvas button')].find((x) => x.textContent.includes('Editar contenido'));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    check('al seleccionar aparece el botón flotante "Editar contenido"', !!floating);
    {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
      require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-map-fullscreen.png', Buffer.from(s.data, 'base64'));
    }

    // ── 3. Modal de contenido (categorías) ─────────────────────────────────
    console.log('\n== Modal de contenido ==');
    if (floating) await clickAt(floating.x, floating.y);
    await sleep(400);
    check('se abre el modal "Contenido de DEMO-1"', await evaluate(`document.body.innerText.includes('Contenido de DEMO-1')`));
    {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-map-content-modal.png', Buffer.from(s.data, 'base64'));
    }

    // Filtra por la categoría a agregar y márcala.
    await evaluate(`(() => {
      const m = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/60') && d.textContent.includes('Contenido de DEMO-1'));
      const input = m?.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(ADD_CATEGORY.name)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    const rowClicked = await evaluate(`(() => {
      const m = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/60') && d.textContent.includes('Contenido de DEMO-1'));
      const b = [...m.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(ADD_CATEGORY.name)});
      b?.click();
      return !!b;
    })()`);
    check('la categoría aparece al buscarla y se puede marcar', rowClicked === true);
    await sleep(200);
    // La categoría de prueba ya vive en otra estantería → aparece el aviso y hay que confirmar.
    const confirmed = await evaluate(`(() => {
      const o = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/70'));
      const b = o ? [...o.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Asignar igualmente') : null;
      b?.click(); return !!b;
    })()`);
    check('confirma el aviso de categoría ya asignada', confirmed === true);
    await sleep(200);
    await evaluate(`(() => {
      const m = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/60') && d.textContent.includes('Contenido de DEMO-1'));
      const b = [...m.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Guardar categorías');
      b?.click();
      return true;
    })()`);
    await sleep(800);
    const modalGone = await evaluate(`!document.body.innerText.includes('Contenido de DEMO-1')`);
    check('el modal se cierra al guardar', modalGone === true);
    const after = await db.query('SELECT category_id FROM shelf_categories WHERE shelf_id = $1 ORDER BY category_id', [SHELF_ID]);
    const afterCats = after.rows.map((r) => Number(r.category_id));
    check('la categoría quedó asociada en la BD', afterCats.includes(ADD_CATEGORY.id), JSON.stringify(afterCats));

    // ── 3b. Tarjeta flotante de la estantería: sus categorías ──────────────
    console.log('\n== Tarjeta flotante de la estantería seleccionada ==');
    // Guardar categorías llama a onRefresh; la selección debe sobrevivir (fix shelfIdsKey).
    const stillFixed = await evaluate(`getComputedStyle(document.querySelector('#map-canvas')).position`);
    check('tras guardar categorías el editor sigue a pantalla completa', stillFixed === 'fixed', stillFixed);
    const cardBtn = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Asociar categorías');
      return b ? { x: b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2,
                     y: b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2 } : null;
    })()`);
    check('la tarjeta flotante ofrece el botón "Asociar categorías"', !!cardBtn);
    const cardText = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Asociar categorías');
      return b ? b.closest('div').parentElement.innerText : '';
    })()`);
    check('la tarjeta lista la categoría recién asociada', cardText.includes(ADD_CATEGORY.name), JSON.stringify(cardText));
    check('la etiqueta "Categorías" está presente en la tarjeta', cardText.includes('Categorías'));
    {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-map-shelf-card.png', Buffer.from(s.data, 'base64'));
    }
    // El botón de la tarjeta abre el mismo modal de categorías.
    if (cardBtn) await clickAt(cardBtn.x, cardBtn.y);
    await sleep(400);
    check('"Asociar categorías" reabre el modal de contenido', await evaluate(`document.body.innerText.includes('Contenido de DEMO-1')`));
    await evaluate(`(() => {
      const m = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/60') && d.textContent.includes('Contenido de DEMO-1'));
      const b = m ? [...m.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cancelar') : null;
      (b || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cancelar'))?.click();
      return true;
    })()`);
    await sleep(300);

    // ── 4. Esc cierra la pantalla completa ─────────────────────────────────
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(400);
    const closed = await evaluate(`!document.querySelector('#map-canvas') && !!document.querySelector('#map-preview')`);
    check('Esc cierra el editor y vuelve la miniatura', closed === true);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-map-content.png', Buffer.from(shot.data, 'base64'));
    console.log('\n  capturas: scripts-agent/.scratch/picking-admin-map-fullscreen.png, -content-modal.png');
  } finally {
    chrome?.kill('SIGKILL');
    // Restaura las categorías originales de la estantería.
    await db.query('DELETE FROM shelf_categories WHERE shelf_id = $1', [SHELF_ID]);
    for (const cid of originalCats) {
      await db.query('INSERT INTO shelf_categories (shelf_id, category_id) VALUES ($1, $2)', [SHELF_ID, cid]);
    }
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
    console.log('\n  limpieza: estantería restaurada y admin temporal eliminado');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
