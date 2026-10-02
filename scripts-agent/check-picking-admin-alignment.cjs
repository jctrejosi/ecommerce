/**
 * Verifica que header, tabs y contenido del panel de picking admin estén
 * alineados: sus contenedores deben empezar en el mismo píxel (antes el
 * contenido iba 20px a la derecha porque el `px-5` estaba en el <header> y no en
 * su contenedor interno).
 *
 * Mide en Chromium headless a varios anchos (donde aplica el `max-w-6xl` y donde
 * no) y guarda una captura como evidencia.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-alignment.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { mkdirSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const DEBUG_PORT = 9336;
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const SHOT = 'scripts-agent/.scratch/picking-admin-alignment.png';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const WIDTHS = [1440, 1200, 900];

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

/** Posiciones (left) de los contenedores y de su primer hijo real. */
const MEASURE = `(() => {
  const wrap = (el) => (el ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null);
  const headerWrap = document.querySelector('header > div');
  // Las tabs ahora van dentro de un contenedor full-width que reserva el
  // scrollbar; el bloque centrado (el que debe alinear) es su hijo.
  const tabsWrap = document.querySelector('main > div > div');
  const scrollBox = document.querySelector('main > div:nth-of-type(2)');
  const contentWrap = document.querySelector('main > div:nth-of-type(2) > div');
  // Primer elemento visible de cada zona: logo del header, primer tab,
  // primer elemento del contenido. Es lo que debe quedar en la misma columna.
  const logo = document.querySelector('header img');
  const firstTab = document.querySelector('main > div button');
  const firstContent = document.querySelector('main > div:nth-of-type(2) p, main > div:nth-of-type(2) h2, main > div:nth-of-type(2) button');
  return {
    headerWrap: wrap(headerWrap),
    tabsWrap: wrap(tabsWrap),
    contentWrap: wrap(contentWrap),
    logo: wrap(logo),
    firstTab: wrap(firstTab),
    firstContent: wrap(firstContent),
    scrollbar: scrollBox ? scrollBox.offsetWidth - scrollBox.clientWidth : 0,
  };
})()`;

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  let chrome = null;
  try {
    const adminHash = (
      await db.query(`SELECT password_hash FROM users WHERE username = 'admin'`)
    ).rows[0]?.password_hash;
    const adminPass = ['admdsi4231', 'admin123'].find((p) =>
      bcrypt.compareSync(p, adminHash ?? ''),
    );
    if (!adminPass) throw new Error('No se pudo resolver la contraseña del admin');

    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1440,1000',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-align-${Date.now()}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        .then((r) => r.json())
        .catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets?.find((t) => t.type === 'page');
    if (!page) throw new Error('Chromium no expuso ninguna página');

    const cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    const { send } = cdp;
    await send('Page.enable');
    await send('Runtime.enable');

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
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
      setter.call(user, 'admin'); user.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pass, ${JSON.stringify(adminPass)}); pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('Estanterías')`)) break;
      await sleep(250);
    }

    console.log('== Alineación header / tabs / contenido ==');
    for (const width of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await sleep(400);
      const m = await evaluate(MEASURE);
      console.log(
        `  ancho ${width}: header=${m.headerWrap} tabs=${m.tabsWrap} contenido=${m.contentWrap} | logo=${m.logo} primerTab=${m.firstTab} primerElemento=${m.firstContent} (scrollbar=${m.scrollbar}px)`,
      );

      const wraps = [m.headerWrap, m.tabsWrap, m.contentWrap];
      const inner = [m.logo, m.firstTab, m.firstContent];
      const alignedWraps = Math.max(...wraps) - Math.min(...wraps) <= 0.5;
      const alignedInner = Math.max(...inner) - Math.min(...inner) <= 0.5;
      check(`ancho ${width}: contenedores alineados`, alignedWraps, wraps.join(' / '));
      check(`ancho ${width}: contenido interno alineado`, alignedInner, inner.join(' / '));
    }

    // Caso con scroll: se inyecta contenido alto para que aparezca el scrollbar
    // del área de contenido y se comprueba que la alineación se mantiene.
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`(() => {
      const box = document.querySelector('main > div:nth-of-type(2) > div');
      const probe = document.createElement('div');
      probe.id = 'qa-tall';
      probe.style.height = '5000px';
      box.appendChild(probe);
      return true;
    })()`);
    await sleep(400);
    const ms = await evaluate(MEASURE);
    console.log(
      `  con scroll: header=${ms.headerWrap} tabs=${ms.tabsWrap} contenido=${ms.contentWrap} | logo=${ms.logo} primerTab=${ms.firstTab} primerElemento=${ms.firstContent} (scrollbar=${ms.scrollbar}px)`,
    );
    const sw = [ms.headerWrap, ms.tabsWrap, ms.contentWrap];
    check(
      'con scroll: contenedores alineados',
      Math.max(...sw) - Math.min(...sw) <= 0.5,
      sw.join(' / '),
    );
    const si = [ms.logo, ms.firstTab, ms.firstContent].filter((v) => v != null);
    check(
      'con scroll: contenido alineado',
      si.length < 2 || Math.max(...si) - Math.min(...si) <= 0.5,
      si.join(' / '),
    );
    await evaluate(`document.getElementById('qa-tall')?.remove()`);

    // Las tabs se movieron dentro de un contenedor nuevo: se comprueba que
    // siguen respondiendo y marcando la activa.
    console.log('\n== Las tabs siguen funcionando ==');
    const labels = [
      'Estanterías',
      'Categorías',
      'Mapa',
      'Productos',
      'Pedidos',
      'Usuarios',
      'Horarios',
    ];
    for (const label of labels) {
      const clicked = await evaluate(`(() => {
        const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        if (!b) return false;
        b.click();
        return true;
      })()`);
      await sleep(600);
      const active = await evaluate(`(() => {
        const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        return !!b && b.className.includes('bg-white') && !b.className.includes('bg-white/5');
      })()`);
      const hasContent = await evaluate(
        `document.querySelector('main > div:nth-of-type(2) > div').children.length > 0`,
      );
      check(`tab "${label}"`, clicked && active && hasContent);
    }

    // Captura de evidencia a 1200px.
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    console.log(`\n  captura: ${SHOT}`);
  } finally {
    chrome?.kill('SIGKILL');
    await db.end();
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
