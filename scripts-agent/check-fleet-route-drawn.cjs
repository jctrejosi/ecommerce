/**
 * Verifica que el mapa del panel delivery-admin pinte la ruta del repartidor
 * con pedido activo (caso: pedido ACCEPTED de Juan, sucursal 1).
 *
 * Señal observable: el badge inferior "N rutas activas" solo aparece cuando las
 * rutas se calcularon y quedaron en el estado del mapa (y por tanto se dibujan).
 * Además guarda una captura para revisión visual.
 *
 * Uso: node scripts-agent/check-fleet-route-drawn.cjs [usuario] [clave]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9487);
const USUARIO = process.argv[2] || 'admin.tid1';
const CLAVE = process.argv[3] || 'admin123';
const OUT_DIR = path.join(__dirname, '.scratch');
const USER_DIR = `/tmp/chrome-route-${Date.now()}`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
function check(name, ok, detail = '') {
  if (!ok) fallos += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function esperarDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* aún arrancando */
    }
    await esperar(250);
  }
  throw new Error('no se pudo conectar al puerto de depuración');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-gpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1500,900',
      `--user-data-dir=${USER_DIR}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();
    const errores = [];
    /** Respuestas /route observadas: {status, len}. */
    const rutas = [];
    const reqUrl = new Map();
    const reqMethod = new Map();

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendientes.has(msg.id)) {
        pendientes.get(msg.id)(msg.result ?? {});
        pendientes.delete(msg.id);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        errores.push(msg.params.exceptionDetails.text ?? 'excepción');
        return;
      }
      if (msg.method === 'Network.requestWillBeSent') {
        reqMethod.set(msg.params.requestId, msg.params.request.method);
        return;
      }
      if (msg.method === 'Network.responseReceived') {
        const { requestId, response } = msg.params;
        if (/\/orders\/\d+\/route/.test(response.url)) {
          reqUrl.set(requestId, response.status);
        }
      }
      if (msg.method === 'Network.loadingFinished') {
        const { requestId } = msg.params;
        // Solo el GET real; el 204 del preflight CORS (OPTIONS) no cuenta.
        if (reqUrl.has(requestId) && reqMethod.get(requestId) === 'GET') {
          rutas.push(reqUrl.get(requestId));
        }
      }
    });

    const enviar = (method, params = {}) =>
      new Promise((resolve) => {
        const msgId = ++id;
        pendientes.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    const evaluar = async (expression) => {
      const { result, exceptionDetails } = await enviar('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text);
      return result?.value;
    };
    const esperarSelector = async (selector, intentos = 100) => {
      for (let i = 0; i < intentos; i++) {
        if (await evaluar(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
        await esperar(400);
      }
      return false;
    };

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Network.enable');

    await enviar('Page.navigate', { url: URL });
    if (!(await esperarSelector('input[autocomplete="username"]'))) {
      throw new Error('no apareció el formulario de login');
    }
    await evaluar(`(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('input[autocomplete="username"]', ${JSON.stringify(USUARIO)});
      set('input[autocomplete="current-password"]', ${JSON.stringify(CLAVE)});
      document.querySelector('button[type="submit"]').click();
      return true;
    })()`);
    if (!(await esperarSelector('header img', 140))) throw new Error('no entró al panel');
    await esperar(3000);

    // Esperar a que el mapa se enfoque en los marcadores (auto-fit tras cargar
    // el estilo y la flota): los pines deben quedar dentro del contenedor.
    const dentro = async () =>
      evaluar(`(() => {
        const cont = document.querySelector('main > div.relative');
        if (!cont) return false;
        const c = cont.getBoundingClientRect();
        const ms = [...document.querySelectorAll('.maplibregl-marker')];
        if (!ms.length) return false;
        return ms.every((m) => {
          const r = m.getBoundingClientRect();
          const x = r.x + r.width / 2, y = r.y + r.height / 2;
          return x >= c.x && x <= c.right && y >= c.y && y <= c.bottom;
        });
      })()`);
    let enfocado = false;
    for (let i = 0; i < 24; i++) {
      if (await dentro()) {
        enfocado = true;
        break;
      }
      await esperar(1000);
    }
    check('el mapa se enfoca en los marcadores activos', enfocado);
    await esperar(2500);

    // Espera a que aparezca el badge de rutas activas (señal de que se pintaron).
    let badge = null;
    for (let i = 0; i < 30; i++) {
      const txt = await evaluar(`(() => {
        const el = [...document.querySelectorAll('div')].find((d) => /\\brutas? activas?\\b/.test(d.textContent || '') && d.className.includes('rounded-full'));
        return el ? el.textContent.trim() : '';
      })()`);
      if (txt) {
        badge = txt;
        break;
      }
      await esperar(1000);
    }

    console.log(`\nrespuestas /route: ${JSON.stringify(rutas)}`);
    console.log(`badge en el mapa: "${badge ?? ''}"`);

    check('se pidieron rutas al backend', rutas.length > 0, `${rutas.length} peticiones`);
    check('todas las rutas respondieron 200', rutas.length > 0 && rutas.every((s) => s === 200));
    check('el mapa muestra "N ruta(s) activa(s)"', Boolean(badge), badge ?? 'sin badge');
    if (badge) {
      check('hay exactamente 1 ruta activa (el pedido aceptado)', /^1 ruta activa/.test(badge), badge);
    }

    {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT_DIR, 'fleet-route.png'), Buffer.from(shot.data, 'base64'));
      }
    }

    // Marcadores visibles y su separación en píxeles (si la ruta es visible).
    const markerInfo = await evaluar(`(() => {
      const ms = [...document.querySelectorAll('.maplibregl-marker')].map((m) => {
        const r = m.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
      });
      let maxDist = 0;
      for (let i = 0; i < ms.length; i++)
        for (let j = i + 1; j < ms.length; j++)
          maxDist = Math.max(maxDist, Math.hypot(ms[i].x - ms[j].x, ms[i].y - ms[j].y));
      return JSON.stringify({ count: ms.length, maxDist: Math.round(maxDist), markers: ms });
    })()`);
    const mi = JSON.parse(markerInfo);
    console.log(`marcadores: ${JSON.stringify(mi)}`);
    check('hay marcadores en el mapa (repartidor + destino)', mi.count >= 2, `${mi.count} marcadores`);
    check(
      'los marcadores están separados en pantalla (ruta visible)',
      mi.maxDist > 60,
      `separación máxima ${mi.maxDist}px`,
    );

    // Seleccionar al repartidor: encuadra su ruta y muestra el detalle.
    await evaluar(`(() => {
      const el = [...document.querySelectorAll('div')].find(
        (d) => d.className.includes('cursor-pointer') && /Juan/.test(d.textContent || ''),
      );
      if (el) el.click();
      return !!el;
    })()`);
    await esperar(2600);
    const rutaBadge = await evaluar(`(() => {
      const el = [...document.querySelectorAll('span')].find((s) => /Ruta:/.test(s.textContent || ''));
      return el ? el.textContent.trim() : '';
    })()`);
    console.log(`badge de la ruta seleccionada: "${rutaBadge}"`);
    check('al seleccionar el repartidor se muestra "Ruta: …"', /Ruta:/.test(rutaBadge), rutaBadge);
    {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT_DIR, 'fleet-route-selected.png'), Buffer.from(shot.data, 'base64'));
      }
    }

    console.log(
      `\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`,
    );
    console.log(fallos === 0 ? '✅ ruta dibujada en el mapa' : `❌ ${fallos} verificación(es) con problemas`);
    ws.close();
    await esperar(300);
    process.exitCode = fallos === 0 && errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(USER_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
