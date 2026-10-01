/**
 * Verifica que el mapa NO se recree al cambiar de pestaña: la instancia de
 * MapLibre y su lienzo deben ser el mismo nodo del DOM, y no deben volver a
 * pedirse tiles.
 *
 *   1. abre el mapa y espera los tiles,
 *   2. marca el lienzo y la instancia,
 *   3. va a Repartidores y vuelve a Mapa,
 *   4. comprueba que el nodo marcado sigue vivo y cuenta las peticiones de tiles
 *      ocurridas durante el cambio de pestaña,
 *   5. comprueba además que los marcadores siguen ahí (no se pierden).
 *
 * Uso: node scripts-agent/check-map-cache.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9411;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
const OUT = path.join(__dirname, '.scratch');

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
  fs.mkdirSync(OUT, { recursive: true });
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
      '--user-data-dir=/tmp/chrome-cache-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();
    const errores = [];
    let peticionesTiles = 0;

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
        const u = msg.params?.request?.url ?? '';
        // En dev los tiles se proxean por `/ofm`; en prod van directo a OpenFreeMap.
        if (/tiles\.openfreemap\.org|\/ofm\//.test(u) && !/fonts/.test(u)) peticionesTiles++;
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
    const irATab = (nombre) =>
      evaluar(`(() => {
        const b = [...document.querySelectorAll('header nav button')].find(
          (n) => n.textContent.trim() === ${JSON.stringify(nombre)},
        );
        b?.click();
        return Boolean(b);
      })()`);

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Network.enable');

    console.log(`[1] abriendo ${URL}`);
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
    if (!(await esperarSelector('canvas.maplibregl-canvas', 120))) {
      throw new Error('no apareció el mapa');
    }
    console.log('[2] mapa cargado, esperando tiles…');
    await esperar(6000);

    const inicial = await evaluar(`(() => {
      const c = document.querySelector('canvas.maplibregl-canvas');
      c.dataset.probe = 'vivo';
      const cont = document.querySelector('.maplibregl-map');
      cont.dataset.probe = 'contenedor';
      return JSON.stringify({
        canvas: [c.width, c.height],
        marcadores: document.querySelectorAll('.ml-pin').length,
        casitas: document.querySelectorAll('.ml-dest').length,
        tilesHastaAhora: 0,
      });
    })()`);
    console.log(`[3] estado inicial: ${inicial}`);
    const tilesAntes = peticionesTiles;
    console.log(`    peticiones de tiles hasta ahora: ${tilesAntes}`);

    console.log('[4] cambiando a Repartidores y de vuelta a Mapa');
    await irATab('Repartidores');
    await esperar(4000);
    await irATab('Mapa');
    await esperar(4000);

    const despues = await evaluar(`(() => {
      const c = document.querySelector('canvas.maplibregl-canvas');
      const cont = document.querySelector('.maplibregl-map');
      const contenedorVisible = cont
        ? cont.closest('main')?.className ?? ''
        : '';
      return JSON.stringify({
        marcadoSigueVivo: c?.dataset.probe === 'vivo',
        contenedorSigueVivo: cont?.dataset.probe === 'contenedor',
        canvasTrasVolver: c ? [c.width, c.height] : null,
        marcadores: document.querySelectorAll('.ml-pin').length,
        casitas: document.querySelectorAll('.ml-dest').length,
        mapaVisible: !contenedorVisible.includes('hidden'),
      });
    })()`);
    console.log(`[5] tras el cambio de pestaña: ${despues}`);
    const tilesDespues = peticionesTiles - tilesAntes;
    console.log(`    peticiones de tiles durante el cambio: ${tilesDespues}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'map-cache.png'), Buffer.from(shot.data, 'base64'));
    }

    const d = JSON.parse(despues);
    const i = JSON.parse(inicial);
    const problemas = [];
    if (!d.marcadoSigueVivo) problemas.push('el lienzo del mapa se recreó (nodo nuevo)');
    if (!d.contenedorSigueVivo) problemas.push('la instancia del mapa se recreó');
    if (!d.mapaVisible) problemas.push('el mapa quedó oculto tras volver a la pestaña');
    if (d.canvasTrasVolver && (d.canvasTrasVolver[0] === 0 || d.canvasTrasVolver[1] === 0)) {
      problemas.push(`lienzo sin tamaño tras volver: ${JSON.stringify(d.canvasTrasVolver)}`);
    }
    if (d.marcadores < i.marcadores) problemas.push('se perdieron marcadores tras volver');
    if (tilesDespues > 8) problemas.push(`se volvieron a pedir ${tilesDespues} tiles al cambiar de pestaña`);

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(
      problemas.length
        ? `❌ ${problemas.join(' · ')}`
        : '✅ el mapa no se recrea ni recarga tiles al cambiar de pestaña',
    );
    ws.close();
    process.exitCode = problemas.length || errores.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-cache-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
