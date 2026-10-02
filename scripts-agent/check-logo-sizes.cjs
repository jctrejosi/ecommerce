/**
 * Verifica los tamaños de los logos del panel de delivery:
 *   - header: logo.png a 23px (5% menos que los 24px anteriores),
 *   - footer: logo.png a 22px (10% menos que los 24px anteriores).
 *
 * Uso: node scripts-agent/check-logo-sizes.cjs [puerto]
 * Requiere: usuario QA temporal (create-qa-admin.cjs) y el panel corriendo.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9485;
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
      '--window-size=1400,900',
      '--user-data-dir=/tmp/chrome-logo-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const problemas = [];

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendientes.has(msg.id)) {
        pendientes.get(msg.id)(msg.result ?? {});
        pendientes.delete(msg.id);
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
    if (!(await esperarSelector('header nav button', 120))) {
      throw new Error(`no entró al panel: ${await evaluar('document.body.innerText.slice(0,150)')}`);
    }
    await esperar(2500);

    const medida = await evaluar(`(() => {
      const header = document.querySelector('header img');
      const footer = document.querySelector('footer img');
      const titulo = header ? header.closest('div').querySelector('p') : null;
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return {
          w: Math.round(b.width * 100) / 100,
          h: Math.round(b.height * 100) / 100,
        };
      };
      return JSON.stringify({
        header: header ? r(header) : null,
        titulo: titulo ? { ...r(titulo), texto: titulo.textContent.trim() } : null,
        footer: footer ? r(footer) : null,
      });
    })()`);
    console.log(`[2] medidas: ${medida}`);
    const { header, titulo, footer } = JSON.parse(medida);

    if (footer.h !== 22) problemas.push(`el logo del footer mide ${footer.h}px de alto (debería ser 22)`);
    if (Math.abs(header.w - titulo.w) > 1) {
      problemas.push(`el logo (${header.w}) y el título (${titulo.w}) no tienen el mismo ancho`);
    }
    if (titulo.texto !== 'Delivery') problemas.push(`título inesperado: ${titulo.texto}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'logos-admin.png'), Buffer.from(shot.data, 'base64'));
    }

    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ tamaños de logos OK');
    process.exitCode = problemas.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-logo-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
