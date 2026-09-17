/**
 * Captura el mapa de flota en dos estados para revisar la opacidad de las rutas:
 *   1) sin selección  → todas las rutas a color pleno
 *   2) con un repartidor seleccionado → las demás atenuadas
 *
 * Usa el usuario temporal de QA (create-qa-admin.cjs) — borrar al terminar.
 *
 * Uso: node scripts-agent/shot-fleet-route-opacity.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9337;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
const DIR = path.join(__dirname, '.scratch');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarDevtools() {
  for (let i = 0; i < 60; i++) {
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
  fs.mkdirSync(DIR, { recursive: true });
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
      '--user-data-dir=/tmp/chrome-opacity-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();
    const peticiones = [];
    const errores = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendientes.has(msg.id)) {
        pendientes.get(msg.id)(msg.result ?? {});
        pendientes.delete(msg.id);
        return;
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const u = msg.params.request.url;
        if (u.includes('/route')) peticiones.push(u);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        errores.push(msg.params.exceptionDetails.text ?? 'excepción');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errores.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
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
    const esperarSelector = async (selector, intentos = 80) => {
      for (let i = 0; i < intentos; i++) {
        if (await evaluar(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
        await esperar(500);
      }
      return false;
    };
    const capturar = async (nombre) => {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (!shot?.data) throw new Error(`no se pudo capturar ${nombre}`);
      const destino = path.join(DIR, nombre);
      fs.writeFileSync(destino, Buffer.from(shot.data, 'base64'));
      console.log(`captura: ${path.relative(path.join(__dirname, '..'), destino)}`);
      return shot.data;
    };

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Network.enable');

    console.log(`[1] abriendo ${URL}`);
    await enviar('Page.navigate', { url: URL });
    if (!(await esperarSelector('input[autocomplete="username"]'))) {
      throw new Error('no apareció el formulario de login');
    }

    console.log(`[2] iniciando sesión como ${USUARIO}`);
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

    console.log('[3] esperando el mapa y la ruta…');
    if (!(await esperarSelector('.maplibregl-map', 120))) throw new Error('no cargó el mapa');
    // La ruta se pide al backend (OSRM) y solo entonces se dibuja.
    for (let i = 0; i < 40 && peticiones.length === 0; i++) await esperar(500);
    // El estilo del mapa tarda: hasta que no haya un pin no está listo.
    if (!(await esperarSelector('.ml-pin', 120))) {
      throw new Error('no aparecieron los pines del mapa');
    }
    await esperar(3000);
    console.log(`    peticiones de ruta: ${peticiones.length}`);
    if (peticiones[0]) console.log(`      · ${peticiones[0].slice(0, 110)}`);

    const pines = await evaluar(`document.querySelectorAll('.ml-pin').length`);
    console.log(`[4] repartidores en el mapa: ${pines}`);
    console.log(`errores de consola hasta aquí: ${errores.length}`);
    await capturar('ruta-sin-seleccion.png');

    console.log('[5] seleccionando el repartidor (clic en su pin)');
    await evaluar(`(() => {
      const pin = document.querySelector('.ml-pin');
      if (!pin) throw new Error('no hay pin de repartidor');
      pin.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    await esperar(3500); // animación de encuadre
    await capturar('ruta-con-seleccion.png');

    console.log(`errores de consola: ${errores.length}`);
    for (const e of errores.slice(0, 6)) console.log(`  · ${e.slice(0, 160)}`);

    ws.close();
    process.exitCode = pines > 0 && peticiones.length > 0 && errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
