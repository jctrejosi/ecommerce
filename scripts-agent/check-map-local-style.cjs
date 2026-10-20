/**
 * Verifica que el mapa del panel delivery-admin use el estilo EMPAQUETADO en el
 * proyecto (`/map/styles/<id>.json`) y el sprite local (`/map/sprites/ofm`), en
 * vez de pedirlos a OpenFreeMap:
 *   - hay una petición 200 a /map/styles/liberty.json,
 *   - hay una petición a /map/sprites/ofm.json,
 *   - NO hay peticiones a /ofm/styles/...,
 *   - el lienzo del mapa se pinta (styleReady).
 *
 * Uso: node scripts-agent/check-map-local-style.cjs [usuario] [clave]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9492);
const USUARIO = process.argv[2] || 'admin.tid1';
const CLAVE = process.argv[3] || 'admin123';
const OUT_DIR = path.join(__dirname, '.scratch');
const USER_DIR = `/tmp/chrome-map-local-${Date.now()}`;

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
    const respuestas = new Map(); // requestId -> {url, status}
    const errores = [];
    const consolas = [];
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
      if (msg.method === 'Runtime.consoleAPICalled') {
        consolas.push(
          (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
        );
      }
      if (msg.method === 'Network.requestWillBeSent') {
        respuestas.set(msg.params.requestId, { url: msg.params.request.url, status: null });
      }
      if (msg.method === 'Network.responseReceived') {
        const r = respuestas.get(msg.params.requestId);
        if (r) r.status = msg.params.response.status;
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
    // Esperar a que el mapa termine de cargar (desaparece "Cargando mapa…"),
    // hasta 40 s — la red del proveedor es intermitente.
    let listo = false;
    for (let i = 0; i < 80; i++) {
      const cargando = await evaluar(
        `document.body.innerText.includes('Cargando mapa') || document.body.innerText.includes('Reintentando')`,
      );
      if (!cargando) {
        listo = true;
        break;
      }
      await esperar(500);
    }
    await esperar(12000);
    const bodyText = await evaluar(
      `document.body.innerText.replace(/\\s+/g,' ').slice(0,400)`,
    );
    console.log(`\ntexto en pantalla: ${bodyText}`);

    const reqs = [...respuestas.values()];
    const styleReq = reqs.find((r) => /\/map\/styles\/[a-z]+\.json/.test(r.url));
    const spriteReq = reqs.find((r) => /\/map\/sprites\/ofm\.json/.test(r.url));
    const ofmStyleReq = reqs.find((r) => /\/ofm\/styles\//.test(r.url));
    const ofmReqs = reqs.filter((r) => /\/ofm\//.test(r.url));
    const porEstado = {};
    for (const r of ofmReqs) {
      const k = `${r.status ?? 'pending'}`;
      porEstado[k] = (porEstado[k] ?? 0) + 1;
    }
    console.log(`\n/ofm peticiones: ${ofmReqs.length} → ${JSON.stringify(porEstado)}`);
    for (const r of reqs) {
      if (/\/(map|ofm)\//.test(r.url)) console.log(`   ${r.status ?? 'pend'} ${r.url}`);
    }
    const fallos502 = ofmReqs.filter((r) => r.status === 502);
    fallos502.slice(0, 8).forEach((r) => console.log(`   502: ${r.url}`));
    console.log(`\nestilo:   ${styleReq ? `${styleReq.url} → ${styleReq.status}` : 'ninguna'}`);
    console.log(`sprite:   ${spriteReq ? `${spriteReq.url} → ${spriteReq.status}` : 'ninguna'}`);
    console.log(`/ofm/styles: ${ofmStyleReq ? `${ofmStyleReq.url} → ${ofmStyleReq.status}` : 'ninguna'}`);

    const canvas = await evaluar(`!!document.querySelector('canvas.maplibregl-canvas')`);
    const cargando = await evaluar(
      `document.body.innerText.includes('Cargando mapa') || document.body.innerText.includes('Reintentando')`,
    );

    check('se pide el estilo empaquetado en el proyecto', !!styleReq, styleReq?.url ?? '');
    check('el estilo local responde 200', styleReq?.status === 200, `status=${styleReq?.status}`);
    check('se pide el sprite local', !!spriteReq, spriteReq?.url ?? '');
    check('NO se pide el estilo a /ofm/styles', !ofmStyleReq);
    check('el mapa se montó (canvas presente)', canvas);
    check('no quedó en pantalla de carga', !cargando);

    {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT_DIR, 'map-local-style.png'), Buffer.from(shot.data, 'base64'));
      }
    }

    console.log(
      `\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`,
    );
    const warns = consolas.filter((c) => /delivery-admin:map/.test(c));
    if (warns.length) console.log(`avisos del mapa:\n   ${warns.join('\n   ')}`);
    console.log(fallos === 0 ? '✅ estilo del mapa empaquetado ok' : `❌ ${fallos} verificación(es) con problemas`);
    ws.close();
    await esperar(300);
    process.exitCode = fallos === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(USER_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
