/**
 * Verifica las etiquetas de los botones de la columna "Acciones" de la tabla de
 * repartidores (deben ser: Mapa, Editar, Chat).
 *
 * Uso: node scripts-agent/check-drivers-actions.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9455;
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
      '--user-data-dir=/tmp/chrome-actions-probe',
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

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');

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
    if (!(await esperarSelector('header nav button', 120))) throw new Error('no entró al panel');
    await esperar(2000);

    console.log('[2] abriendo la pestaña Repartidores');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Repartidores',
      );
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(2500);

    const filas = await evaluar(`(() => {
      const filas = [...document.querySelectorAll('tbody tr')].slice(0, 3);
      return JSON.stringify(
        filas.map((tr) => ({
          nombre: (tr.querySelector('td')?.innerText || '').split('\\n')[0].trim(),
          botones: [...tr.querySelectorAll('button')].map((b) => ({
            etiqueta: b.innerText.replace(/\\s+/g, ' ').trim(),
            title: b.getAttribute('title'),
          })),
        })),
      );
    })()`);
    console.log(`[3] acciones por fila:\n${filas}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'drivers-actions.png'), Buffer.from(shot.data, 'base64'));
    }

    const rows = JSON.parse(filas);
    const problemas = [];
    if (!rows.length) problemas.push('no hay filas en la tabla');
    for (const r of rows) {
      const etiquetas = r.botones.map((b) => b.etiqueta).join(' | ');
      if (!/^Mapa$/.test(r.botones[0]?.etiqueta ?? '')) {
        problemas.push(`${r.nombre}: el primer botón dice "${r.botones[0]?.etiqueta}" (se esperaba "Mapa")`);
      }
      if (/ver en el mapa/i.test(etiquetas)) {
        problemas.push(`${r.nombre}: sigue apareciendo "Ver en el mapa" en las etiquetas`);
      }
      if (!/Editar/.test(etiquetas) || !/Chat/.test(etiquetas)) {
        problemas.push(`${r.nombre}: faltan los botones Editar/Chat (${etiquetas})`);
      }
    }

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ acciones: Mapa | Editar | Chat');
    ws.close();
    process.exitCode = problemas.length || errores.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-actions-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
