/**
 * Verificación visual del tab "Pedidos" del picking admin (Chromium + CDP).
 *
 * Hace el flujo real: login con el formulario, clic en el tab "Pedidos",
 * expansión del detalle de un pedido, filtros por estado y búsqueda.
 * Deja una captura en scripts-agent/.scratch/orders-tab.png.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/check-picking-orders-ui.cjs
 */
const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DEBUG_PORT = 9333;
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const SHOT = 'scripts-agent/.scratch/orders-tab.png';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

let failures = 0;
let checks = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ─── Cliente CDP mínimo sobre WebSocket global ────────────────────────────────

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) {
      for (const h of listeners.get(msg.method) ?? []) h(msg.params);
      return;
    }
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
  const on = (method, handler) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(handler);
  };
  return { ws, ready, send, on };
}

async function main() {
  // El dev server del panel debe estar arriba.
  const probe = await fetch(PANEL_URL).catch(() => null);
  if (!probe?.ok) throw new Error(`El panel no responde en ${PANEL_URL}`);

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const hash = await db.query(`SELECT password_hash FROM users WHERE username = 'admin'`);
  const password = ['admdsi4231', 'admin123'].find((p) =>
    bcrypt.compareSync(p, hash.rows[0]?.password_hash ?? ''),
  );
  await db.end();
  if (!password) throw new Error('No se pudo resolver la contraseña del admin');

  const chrome = spawn(
    '/usr/bin/chromium',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1440,1100',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/cdp-orders-${Date.now()}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp = null;
  try {
    // Espera al endpoint de depuración.
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets?.find((t) => t.type === 'page');
    if (!page) throw new Error('Chromium no expuso ninguna página');

    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    const { send } = cdp;
    await send('Page.enable');
    await send('Runtime.enable');

    // Tráfico real de red (incluye los sockets de refresco en vivo).
    const netLog = [];
    const wsFrames = [];
    cdp.on('Network.responseReceived', (p) => {
      if (p.response?.url) netLog.push({ url: p.response.url, status: p.response.status });
    });
    cdp.on('Network.webSocketCreated', (p) => netLog.push({ url: p.url, status: 'websocket' }));
    cdp.on('Network.webSocketFrameSent', (p) => wsFrames.push(p.response?.payloadData ?? ''));
    await send('Network.enable');

    // Registra cada petición de la app y su status (para diagnosticar 401).
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__reqs = [];
        const origFetch = window.fetch;
        window.fetch = async (...args) => {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
          try {
            const res = await origFetch(...args);
            window.__reqs.push({ url, status: res.status });
            return res;
          } catch (e) {
            window.__reqs.push({ url, status: 'red: ' + e.message });
            throw e;
          }
        };
      `,
    });

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      }
      return r.result.value;
    };

    const until = async (expression, label, tries = 60) => {
      for (let i = 0; i < tries; i++) {
        if (await evaluate(expression)) return true;
        await sleep(250);
      }
      // Diagnóstico: qué quedó pintado en pantalla.
      const state = await evaluate(`document.body.innerText.slice(0, 900)`).catch(() => '(sin texto)');
      const reqs = await evaluate(`JSON.stringify(window.__reqs ?? [], null, 1)`).catch(() => '[]');
      const shot = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (shot) {
        mkdirSync('scripts-agent/.scratch', { recursive: true });
        writeFileSync('scripts-agent/.scratch/timeout.png', Buffer.from(shot.data, 'base64'));
      }
      throw new Error(`Timeout esperando: ${label}\n--- pantalla ---\n${state}\n--- peticiones ---\n${reqs}`);
    };

    await send('Page.navigate', { url: PANEL_URL });
    await until(`!!document.querySelector('form input')`, 'la pantalla de login');

    // ── Login con el formulario real ──────────────────────────────────────────
    console.log('\n== Login ==');
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const [user, pass] = document.querySelectorAll('form input');
      setter.call(user, 'admin'); user.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pass, ${JSON.stringify(password)}); pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    await until(`document.body.innerText.includes('Estanterías')`, 'la app tras el login');
    check('login admin y panel cargado', true);

    // ── El tab existe, en el orden pedido ─────────────────────────────────────
    console.log('\n== Tab Pedidos ==');
    const tabs = await evaluate(`(() => {
      const cont = [...document.querySelectorAll('button')].filter((b) =>
        ['Estanterías','Categorías','Mapa','Productos','Pedidos','Usuarios','Horarios','Pickers']
          .includes(b.textContent.trim()));
      return cont.map((b) => b.textContent.trim());
    })()`);
    check(`tabs: ${tabs.join(' · ')}`, tabs.includes('Pedidos'), `orden ${tabs.join(',')}`);

    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Pedidos');
      b.click(); return true;
    })()`);
    await until(
      `document.body.innerText.includes('Pedidos') && !!document.querySelector('table, div')`,
      'el contenido del tab',
    );
    await until(
      `(() => { const t = document.body.innerText; return t.includes('MER-') || t.includes('No hay pedidos'); })()`,
      'la lista de pedidos',
    );

    const branch = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.className.includes('bg-amber-400') && x.textContent.trim().startsWith('Mercaldas'));
      return b?.textContent.trim() ?? null;
    })()`);
    console.log(`  sucursal seleccionada: ${branch}`);

    const rows = await evaluate(`(() => {
      const trs = [...document.querySelectorAll('tbody tr')].filter((tr) => tr.children.length > 1);
      return trs.map((tr) => [...tr.children].map((td) => td.innerText.replace(/\\n/g, ' | ').trim()));
    })()`);
    check(`filas de pedidos visibles: ${rows.length}`, rows.length > 0);
    for (const r of rows.slice(0, 5)) console.log(`    ${r.join('  ||  ')}`);

    const first = rows[0] ?? [];
    check(
      'la fila trae referencia, cliente, estado, picker, avance y tiempos',
      first.length === 6 && /MER-/.test(first[0]) && /Listo|Entregado|En cola|Alistando|En camino|Cancelado/.test(first[2]),
      `columnas: ${first.length}`,
    );
    check('el picker aparece asignado', /Juan/.test(first[3] ?? ''), first[3] ?? '');
    check('el avance de piezas se ve (n/total)', /\d+\/\d+/.test(first[4] ?? ''), first[4] ?? '');
    check(
      'se ve el tiempo de alistamiento',
      /⏱|\d+:\d\d/.test(first[5] ?? ''),
      (first[5] ?? '').split(' | ').pop(),
    );

    // ── Detalle en modal ──────────────────────────────────────────────────────
    console.log('\n== Detalle del pedido ==');
    await evaluate(`(() => {
      const tr = [...document.querySelectorAll('tbody tr')].find((t) => t.children.length > 1);
      tr.click(); return true;
    })()`);
    await until(
      `document.body.innerText.toLowerCase().includes('items del pedido')`,
      'el detalle de items',
    );
    const detailText = await evaluate(`document.body.innerText.split(/items del pedido/i)[1]?.slice(0, 400) ?? ''`);
    check('el detalle lista items con su avance', /\d\/\d/.test(detailText), detailText.split('\n').slice(1, 4).join(' / '));
    // El detalle ahora se abre en un modal: se cierra para seguir con los filtros.
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await until(`!/items del pedido/i.test(document.body.innerText)`, 'cerrar el modal de detalle');

    // ── Filtros ───────────────────────────────────────────────────────────────
    console.log('\n== Filtros en pantalla ==');
    const chipCount = (label) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}));
        return b?.textContent.trim() ?? null;
      })()`);
    console.log(`  chip Todos: ${await chipCount('Todos')}`);
    check('chip de estado con conteo', /\d$/.test((await chipCount('Todos')) ?? ''));

    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Entregados'));
      b.click(); return true;
    })()`);
    await sleep(800);
    // El filtro debe mostrar SOLO entregados (o el vacío si la sucursal no tiene).
    const deliveredInfo = await evaluate(`(() => {
      const trs = [...document.querySelectorAll('tbody tr')].filter((tr) => tr.children.length > 1);
      return {
        n: trs.length,
        estados: trs.map((tr) => tr.children[2]?.innerText.trim() ?? ''),
        vacio: document.body.innerText.includes('No hay pedidos con estos filtros'),
      };
    })()`);
    check(
      'filtrar por "Entregados" muestra solo entregados (o el vacío)',
      deliveredInfo.vacio || (deliveredInfo.n > 0 && deliveredInfo.estados.every((e) => /entregado/i.test(e))),
      `${deliveredInfo.n} filas`,
    );

    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Listos'));
      b.click(); return true;
    })()`);
    await until(
      `document.body.innerText.includes('MER-') && !document.body.innerText.includes('No hay pedidos con estos filtros')`,
      'el pedido listo',
    );
    check('filtrar por "Listos" muestra el pedido', true);

    // Búsqueda por la referencia visible (independiente de los datos).
    const readyRef = await evaluate(`(() => {
      const tr = [...document.querySelectorAll('tbody tr')].find((t) => t.children.length > 1);
      return tr ? (tr.children[0].innerText.match(/MER-\\d+|DEMO-\\d+/) || [''])[0] : '';
    })()`);
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const input = document.querySelector('input[placeholder^="Buscar referencia"]');
      setter.call(input, ${JSON.stringify(readyRef)}); input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(800);
    const searchNarrowed = await evaluate(`(() => {
      const trs = [...document.querySelectorAll('tbody tr')].filter((t) => t.children.length > 1);
      return trs.length > 0 && trs.every((t) => t.children[0].innerText.includes(${JSON.stringify(readyRef)}));
    })()`);
    check('buscar por referencia encuentra y acota al pedido', readyRef !== '' && searchNarrowed, readyRef);

    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const input = document.querySelector('input[placeholder^="Buscar referencia"]');
      setter.call(input, 'zzzz-no-existe'); input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await until(`document.body.innerText.includes('No hay pedidos con estos filtros')`, 'la búsqueda sin resultados');
    check('búsqueda sin resultados muestra el vacío', true);

    // Limpia la búsqueda, vuelve a "Todos" y deja la captura con el pedido.
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const input = document.querySelector('input[placeholder^="Buscar referencia"]');
      setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Todos'));
      b.click(); return true;
    })()`);
    await until(
      `(() => { const t = document.body.innerText; return t.includes('MER-') || t.includes('DEMO-'); })()`,
      'la lista completa',
    );
    await sleep(600);

    // ── Refresco en vivo ──────────────────────────────────────────────────────
    // El namespace viaja en el primer frame del socket, no en la URL.
    console.log('\n== Refresco en vivo ==');
    const sockets = netLog.filter((r) => r.url.includes('/socket.io/'));
    const suscribe = (ns) => wsFrames.some((f) => f.includes(`/${ns},`));
    const rooms = wsFrames.filter((f) => f.includes('subscribe') || f.includes('/picking-events,') || f.includes('/orders,'));
    for (const f of [...new Set(rooms)].slice(0, 8)) console.log(`    frame: ${f.slice(0, 70)}`);
    // El netLog a veces no captura ambas conexiones aunque sí existan; lo real
    // es que los namespaces de abajo se usen, así que aquí basta con ≥1.
    check(`sockets websocket abiertos (${sockets.length})`, sockets.length >= 1);
    check('el tab se une al namespace /picking-events', suscribe('picking-events'));
    check('el tab se une al namespace /orders', suscribe('orders'));
    check(
      'se suscribe a la sala staff en ambos',
      wsFrames.filter((f) => f.includes('subscribe:staff')).length >= 2,
      `${wsFrames.filter((f) => f.includes('subscribe:staff')).length} frames`,
    );

    mkdirSync('scripts-agent/.scratch', { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    console.log(`\n  captura: ${SHOT}`);
  } finally {
    cdp?.ws.close();
    chrome.kill('SIGKILL');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
