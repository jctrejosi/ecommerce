/**
 * Verifica el login del panel de picking admin:
 *   - arriba el logo de la tienda configurado en el admin (Cloudinary),
 *   - en medio el formulario,
 *   - abajo el picking.png.
 *
 * Deja una captura en scripts-agent/.scratch/picking-admin-login.png.
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/check-picking-admin-login.cjs
 */
const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');

const DEBUG_PORT = 9334;
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const SHOT = 'scripts-agent/.scratch/picking-admin-login.png';

let failures = 0;
let checks = 0;
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
  return { ws, ready, send };
}

async function main() {
  const probe = await fetch(PANEL_URL).catch(() => null);
  if (!probe?.ok) throw new Error(`El panel no responde en ${PANEL_URL}`);

  const chrome = spawn(
    '/usr/bin/chromium',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1000,900',
      `--remote-debugging-port=${DEBUG_PORT}`,
      // Perfil nuevo: sin cookie de sesión, así se ve el login.
      `--user-data-dir=/tmp/cdp-login-${Date.now()}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp = null;
  try {
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

    cdp = connect(page.webSocketDebuggerUrl);
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
      throw new Error(`Timeout esperando: ${label}`);
    };

    await send('Page.navigate', { url: PANEL_URL });
    await until(`!!document.querySelector('form input')`, 'el formulario de login');
    // Espera a que las imágenes terminen de cargar (o fallen).
    await until(
      `[...document.querySelectorAll('img')].every(i => i.complete)`,
      'que carguen las imágenes',
      40,
    );
    await sleep(400);

    console.log('\n== Imágenes del login ==');
    const imgs = await evaluate(`
      (() => {
        const form = document.querySelector('form');
        const formRect = form.getBoundingClientRect();
        return [...document.querySelectorAll('img')].map((i) => {
          const r = i.getBoundingClientRect();
          return {
            src: i.currentSrc || i.src,
            natural: [i.naturalWidth, i.naturalHeight],
            box: [Math.round(r.width), Math.round(r.height)],
            arribaDelFormulario: r.bottom <= formRect.top + 1,
            debajoDelFormulario: r.top >= formRect.bottom - 1,
          };
        });
      })()
    `);
    for (const i of imgs) {
      console.log(
        `    ${i.src.slice(0, 72)} · natural ${i.natural.join('x')} · caja ${i.box.join('x')}` +
          `${i.arribaDelFormulario ? ' · ARRIBA del form' : i.debajoDelFormulario ? ' · DEBAJO del form' : ''}`,
      );
    }

    const tienda = imgs.find((i) => /cloudinary|logo_mercaldas/i.test(i.src));
    const marca = imgs.find((i) => /picking/i.test(i.src) && i !== tienda);

    check('el logo de la tienda está en el login', !!tienda, tienda?.src.slice(0, 60));
    check(
      'el logo de la tienda cargó de verdad',
      !!tienda && tienda.natural[0] > 0 && tienda.natural[1] > 0,
      tienda ? `${tienda.natural.join('x')} natural` : '',
    );
    check('el logo de la tienda queda ARRIBA del formulario', !!tienda && tienda.arribaDelFormulario);
    check('el picking.png está en el login', !!marca, marca?.src.slice(0, 60));
    check(
      'el picking.png cargó de verdad',
      !!marca && marca.natural[0] > 0,
      marca ? `${marca.natural.join('x')} natural` : '',
    );
    check('el picking.png queda DEBAJO del formulario', !!marca && marca.debajoDelFormulario);
    check(
      'el orden vertical es logo tienda → formulario → picking',
      !!tienda && !!marca && tienda.arribaDelFormulario && marca.debajoDelFormulario,
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
