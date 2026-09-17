/**
 * Captura la sección "Pedidos" del panel de delivery admin en un Chromium
 * headless, para revisar a ojo la columna "Tiempos".
 *
 * Usa el usuario temporal de QA (create-qa-admin.cjs) — borrar al terminar.
 *
 * Uso: node scripts-agent/shot-orders-timeline.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9336;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
const CAPTURA = path.join(__dirname, '.scratch', 'orders-timeline.png');

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
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1600,1000',
      '--user-data-dir=/tmp/chrome-orders-probe',
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

    await esperarSelector('.maplibregl-map', 120);
    await esperar(1500);

    console.log('[3] abriendo la pestaña Pedidos');
    await evaluar(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pedidos');
      if (!btn) throw new Error('no encontré el botón Pedidos');
      btn.click();
      return true;
    })()`);
    await esperar(2500);

    const filas = await evaluar(`document.querySelectorAll('tbody tr').length`);
    const headers = await evaluar(
      `JSON.stringify([...document.querySelectorAll('thead th')].map((th) => th.textContent.trim()))`,
    );
    const primera = await evaluar(`(() => {
      const td = [...document.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()));
      return JSON.stringify(td.slice(0, 4));
    })()`);
    console.log(`[4] filas: ${filas}`);
    console.log(`    cabeceras: ${headers}`);
    console.log(`    primeras filas: ${primera}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.mkdirSync(path.dirname(CAPTURA), { recursive: true });
      fs.writeFileSync(CAPTURA, Buffer.from(shot.data, 'base64'));
      console.log(`captura: ${path.relative(path.join(__dirname, '..'), CAPTURA)}`);
    }
    console.log(`errores de consola: ${errores.length}`);
    for (const e of errores.slice(0, 6)) console.log(`  · ${e.slice(0, 160)}`);

    ws.close();
    process.exitCode = filas > 0 && errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
