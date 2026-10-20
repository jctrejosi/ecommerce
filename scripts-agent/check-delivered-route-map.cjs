/**
 * Verifica en el panel delivery-admin que, para un pedido ENTREGADO, la acción de
 * mapa redirige a la pestaña "Mapa" y pinta:
 *   - el marcador del domicilio (casita) y el de la sucursal de salida,
 *   - la ruta histórica tienda → domicilio (petición /route?target=customer&from=),
 *   - la tarjeta flotante con "Entregado", repartidor, dirección, sucursal y ruta/tiempo.
 * Al cerrar con la X, la tarjeta desaparece.
 *
 * Uso: node scripts-agent/check-delivered-route-map.cjs [usuario] [clave]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9490);
const USUARIO = process.argv[2] || 'admin.tid1';
const CLAVE = process.argv[3] || 'admin123';
const OUT_DIR = path.join(__dirname, '.scratch');
const USER_DIR = `/tmp/chrome-deliv-route-${Date.now()}`;

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
      '--window-size=1600,950',
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
    const peticionesRuta = [];
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
      if (msg.method === 'Network.requestWillBeSent') {
        const url = msg.params?.request?.url ?? '';
        const method = msg.params?.request?.method ?? 'GET';
        if (method === 'GET' && /\/orders\/\d+\/route/.test(url)) {
          peticionesRuta.push(url);
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
    await esperar(2500);

    // Ir a la pestaña Pedidos y filtrar Entregados.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('nav button')].find((x) => x.textContent.trim() === 'Pedidos');
      if (b) b.click();
      return !!b;
    })()`);
    if (!(await esperarSelector('table tbody tr', 120))) throw new Error('no cargó la tabla de pedidos');
    await esperar(500);

    const filtroOk = await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Entregados');
      if (b) b.click();
      return !!b;
    })()`);
    check('existe el filtro "Entregados"', filtroOk);
    await esperar(1400);

    const filas = await evaluar(
      `document.querySelectorAll('table tbody tr').length`,
    );
    check('hay pedidos entregados en la tabla', filas > 0, `filas=${filas}`);
    if (!filas) throw new Error('no hay pedidos entregados en la tabla');

    const refRow = await evaluar(
      `document.querySelector('table tbody tr td p.font-mono')?.textContent.trim() ?? ''`,
    );
    console.log(`\npedido entregado de prueba: ${refRow}`);

    // Pulsar la acción de mapa de la primera fila entregada.
    const clic = await evaluar(`(() => {
      const btn = document.querySelector('table tbody tr button[title="Ver el recorrido en el mapa"]');
      if (btn) btn.click();
      return !!btn;
    })()`);
    check('la fila entregada tiene la acción de recorrido', clic);

    // Esperar a que se pinte la tarjeta del pedido enfocado (mapa).
    const tarjeta = await esperarSelector('div.absolute.left-4.top-4.z-500', 60);
    check('se abre la tarjeta del recorrido en el mapa', tarjeta);
    // Dar tiempo a que cargue el estilo y se calcule la ruta (OSRM).
    await esperar(9000);

    const info = await evaluar(`(() => {
      const card = document.querySelector('div.absolute.left-4.top-4.z-500');
      const txt = card ? card.textContent.replace(/\\s+/g, ' ').trim() : '';
      return JSON.stringify({
        txt,
        markers: document.querySelectorAll('.maplibregl-marker').length,
        dest: document.querySelectorAll('.ml-dest').length,
        branch: document.querySelectorAll('.ml-branch').length,
        canvas: !!document.querySelector('canvas.maplibregl-canvas'),
      });
    })()`);
    const data = JSON.parse(info);
    console.log(JSON.stringify(data, null, 1));

    check('la tarjeta muestra "Entregado"', /Entregado/.test(data.txt));
    check('la tarjeta indica la dirección de entrega', /Dirección de entrega/.test(data.txt));
    check('la tarjeta indica la sucursal de salida', /Sucursal de salida/.test(data.txt));
    check(
      'la tarjeta muestra la ruta con su tiempo (km/m · ≈ min)',
      /(km|\bm\b).*≈\s*\d+\s*min/.test(data.txt),
      data.txt.slice(-80),
    );
    check('hay al menos 2 marcadores (domicilio + sucursal)', data.markers >= 2, `markers=${data.markers}`);
    check('se pintó el marcador de casita', data.dest >= 1, `dest=${data.dest}`);
    check('se pintó el marcador de sucursal', data.branch >= 1, `branch=${data.branch}`);

    check(
      'se solicitó la ruta tienda → domicilio al backend',
      peticionesRuta.length > 0,
      peticionesRuta[0] ?? 'ninguna',
    );

    {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT_DIR, 'order-delivered-route.png'), Buffer.from(shot.data, 'base64'));
      }
    }

    // Cerrar la tarjeta con la X.
    await evaluar(`(() => {
      const card = document.querySelector('div.absolute.left-4.top-4.z-500');
      const btn = card && card.querySelector('button[title="Quitar del mapa"]');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await esperar(800);
    const cerrada = await evaluar(`!document.querySelector('div.absolute.left-4.top-4.z-500')`);
    check('la X quita el recorrido del mapa', cerrada);

    console.log(
      `\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`,
    );
    console.log(fallos === 0 ? '✅ recorrido de pedido entregado ok' : `❌ ${fallos} verificación(es) con problemas`);
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
