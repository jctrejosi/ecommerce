/**
 * Verifica en un Chromium headless, contra el panel real, que al pulsar un
 * repartidor quedan visibles en el mapa **él y la casa del cliente** (antes el
 * mapa centraba solo en el repartidor y el destino quedaba fuera de pantalla).
 *
 * Usa el usuario temporal de QA (create-qa-admin.cjs) y borra sus datos de
 * sesión al terminar. El navegador no se ve: se conduce por CDP.
 *
 * Uso: node scripts-agent/check-admin-map-click.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CAPTURA = path.join(__dirname, '.scratch', 'panel-map.png');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9334;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';

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
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-gpu',
      // WebGL por software: MapLibre lo necesita para dibujar el mapa.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1440,900',
      '--user-data-dir=/tmp/chrome-map-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();
    const errores = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendientes.has(msg.id)) {
        pendientes.get(msg.id)(msg.result ?? {});
        pendientes.delete(msg.id);
        return;
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

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');

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

    console.log('[3] esperando el mapa y los pines…');
    if (!(await esperarSelector('.ml-pin', 120))) {
      const texto = await evaluar('document.body.innerText.slice(0, 300)');
      throw new Error(`no aparecieron los pines del mapa. Pantalla: ${texto}`);
    }
    await esperar(2500); // deja asentar el encuadre inicial

    const antes = await evaluar(`JSON.stringify({
      pines: document.querySelectorAll('.ml-pin').length,
      casitas: document.querySelectorAll('.ml-dest').length,
    })`);
    console.log(`[4] estado inicial: ${antes}`);

    console.log('[5] clic en el pin del repartidor');
    await evaluar(`(() => {
      const pin = document.querySelector('.ml-pin');
      pin.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    await esperar(2500); // animación de encuadre

    const dentro = (sel) => `(() => {
      const cont = document.querySelector('.maplibregl-map');
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!cont || !el) return null;
      const c = cont.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return {
        etiqueta: ${JSON.stringify(sel)},
        visible: cx >= c.left && cx <= c.right && cy >= c.top && cy <= c.bottom,
        centro: [Math.round(cx), Math.round(cy)],
        mapa: [Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)],
      };
    })()`;

    const pin = await evaluar(dentro('.ml-pin'));
    const casa = await evaluar(dentro('.ml-dest'));
    const sucursal = await evaluar(dentro('.ml-branch'));
    const iconoSucursal = await evaluar(`(() => {
      const el = document.querySelector('.ml-branch-inner');
      return el ? el.textContent : null;
    })()`);
    console.log(`[6] pin del repartidor : ${pin ? JSON.stringify(pin) : 'no está en el DOM'}`);
    console.log(`[7] casa del cliente   : ${casa ? JSON.stringify(casa) : 'NO SE DIBUJÓ'}`);
    console.log(
      `[8] sucursal de recogida: ${sucursal ? JSON.stringify(sucursal) : 'NO SE DIBUJÓ'}` +
        ` · icono: ${iconoSucursal ?? '—'}`,
    );

    const ok = Boolean(pin?.visible) && Boolean(casa?.visible) && Boolean(sucursal?.visible);
    console.log(`\nRESULTADO: ${ok ? 'OK (repartidor, cliente y sucursal visibles)' : 'FALLO'}`);
    console.log(`errores de consola: ${errores.length}`);
    for (const e of errores.slice(0, 6)) console.log(`  · ${e.slice(0, 160)}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.mkdirSync(path.dirname(CAPTURA), { recursive: true });
      fs.writeFileSync(CAPTURA, Buffer.from(shot.data, 'base64'));
      console.log(`captura: ${path.relative(path.join(__dirname, '..'), CAPTURA)}`);
    }

    ws.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
