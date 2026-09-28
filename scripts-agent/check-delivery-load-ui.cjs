/**
 * Verifica en el navegador (headless) que el panel de delivery admin muestre la
 * ocupación de los vehículos y permita editar la capacidad.
 *
 *   1. entra al panel con el usuario temporal de QA,
 *   2. abre la pestaña "Repartidores" y comprueba la columna "Ocupación",
 *   3. abre la ficha de un repartidor y captura su texto de ocupación,
 *   4. verifica el campo "Capacidad (litros)" en el formulario de edición,
 *   5. guarda una captura y reporta errores de consola.
 *
 * Uso: node scripts-agent/check-delivery-load-ui.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9351;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
const CAPTURA = path.join(__dirname, '.scratch', 'delivery-load.png');

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
  fs.mkdirSync(path.dirname(CAPTURA), { recursive: true });
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
      '--window-size=1600,900',
      '--user-data-dir=/tmp/chrome-load-probe',
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
    /** Busca un elemento por su texto visible y hace clic. */
    const clicPorTexto = (tag, texto) =>
      evaluar(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find(
          (n) => n.textContent.trim().toLowerCase() === ${JSON.stringify(texto)}.toLowerCase(),
        );
        if (!el) return false;
        el.click();
        return true;
      })()`);

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

    if (!(await esperarSelector('header img', 120))) {
      const texto = await evaluar('document.body.innerText.slice(0, 200)');
      throw new Error(`no entró al panel. Pantalla: ${texto}`);
    }
    await esperar(2000);

    console.log('[3] abriendo la pestaña Repartidores');
    const tabs = await evaluar(
      `JSON.stringify([...document.querySelectorAll('button,nav a')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 20))`,
    );
    console.log(`    controles: ${tabs}`);
    const ok = await clicPorTexto('button', 'Repartidores');
    console.log(`    clic en "Repartidores": ${ok}`);
    await esperar(2500);

    const tabla = await evaluar(`(() => {
      const ths = [...document.querySelectorAll('th')].map((t) => t.textContent.trim());
      const filas = [...document.querySelectorAll('tbody tr')].slice(0, 4).map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\\n/g, ' | ').trim()),
      );
      return JSON.stringify({ ths, filas }, null, 1);
    })()`);
    console.log(`[4] tabla de repartidores:\n${tabla}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(CAPTURA, Buffer.from(shot.data, 'base64'));
      console.log(`captura: ${path.relative(path.join(__dirname, '..'), CAPTURA)}`);
    }

    console.log('[5] abriendo el formulario de edición (clic en la primera fila)');
    await evaluar(`(() => {
      const tr = document.querySelector('tbody tr');
      if (tr) tr.click();
      return Boolean(tr);
    })()`);
    await esperar(2000);

    const modal = await evaluar(`(() => {
      const labels = [...document.querySelectorAll('label')].map((l) => l.textContent.trim());
      const input = [...document.querySelectorAll('label')].find((l) =>
        l.textContent.includes('Capacidad'),
      )?.querySelector('input');
      return JSON.stringify({
        tieneCampoCapacidad: Boolean(input),
        valor: input ? input.value : null,
        labels: labels.slice(0, 14),
        titulo: document.querySelector('h2')?.textContent?.trim() ?? null,
      });
    })()`);
    console.log(`[6] modal de edición: ${modal}`);

    const shot2 = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot2?.data) {
      fs.writeFileSync(
        path.join(__dirname, '.scratch', 'delivery-load-modal.png'),
        Buffer.from(shot2.data, 'base64'),
      );
      console.log('captura: scripts-agent/.scratch/delivery-load-modal.png');
    }

    console.log(`errores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    ws.close();
    process.exitCode = errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-load-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
