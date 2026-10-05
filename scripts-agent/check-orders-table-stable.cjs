/**
 * Comprueba que la tabla de pedidos del panel no cambia de tamaño al cambiar
 * de filtro: mismo ancho de columnas, mismo ancho y alto de contenedor, con
 * y sin scroll interno.
 *
 * Uso: node scripts-agent/check-orders-table-stable.cjs [puerto]
 * Requiere: usuario QA temporal (create-qa-admin.cjs) y el panel corriendo.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9486;
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
      '--user-data-dir=/tmp/chrome-orders-measure-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

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
    const capturar = async (nombre) => {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT, nombre), Buffer.from(shot.data, 'base64'));
      }
    };

    const MEDIDA = `JSON.stringify((() => {
      const table = document.querySelector('main table');
      if (!table) return { hayTabla: false };
      const cont = table.parentElement;
      const rect = table.getBoundingClientRect();
      const crect = cont.getBoundingClientRect();
      const main = document.querySelector('main');
      const mrect = main.getBoundingClientRect();
      return {
        hayTabla: true,
        filas: table.querySelectorAll('tbody tr').length,
        tablaAlto: Math.round(rect.height),
        tablaAncho: Math.round(rect.width),
        contAlto: Math.round(crect.height),
        contAncho: Math.round(crect.width),
        contBottomVsMain: Math.round(crect.bottom - mrect.bottom),
        contScroll: cont.scrollHeight > cont.clientHeight,
        paginaScroll: document.documentElement.scrollHeight > window.innerHeight,
        ths: [...table.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width)),
      };
    })())`;

    const irAPedidos = `(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Pedidos');
      if (b) b.click();
      return Boolean(b);
    })()`;

    const clickFiltro = (label) => `(() => {
      const b = [...document.querySelectorAll('button')].find(
        (n) => n.textContent.trim() === ${JSON.stringify(label)});
      if (b) b.click();
      return Boolean(b);
    })()`;

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
    if (!(await esperarSelector('button[title="Chat con repartidores"]', 120))) {
      throw new Error('no entró al panel');
    }
    await esperar(2000);

    console.log('[2] ir a Pedidos');
    await evaluar(irAPedidos);
    await esperar(2500);

    const medidas = [];
    for (const label of ['Todos', 'Entregados', 'Cancelados', 'En entrega']) {
      await evaluar(clickFiltro(label));
      await esperar(1800);
      const m = JSON.parse(await evaluar(MEDIDA));
      medidas.push({ label, ...m });
      console.log(`[${label}] ${JSON.stringify(m)}`);
      await capturar(`pedidos-${label.toLowerCase().replace(/\s+/g, '-')}.png`);
    }

    // ── La tabla no debe cambiar de tamaño entre filtros ──
    const problemas = [];
    const base = medidas[0];
    if (!base.hayTabla) problemas.push('no se encontró la tabla de pedidos');
    for (const m of medidas.slice(1)) {
      if (!m.hayTabla) {
        problemas.push(`${m.label}: no hay tabla`);
        continue;
      }
      if (m.ths.join(',') !== base.ths.join(',')) {
        problemas.push(`${m.label}: columnas ${m.ths} vs ${base.ths}`);
      }
      if (m.tablaAncho !== base.tablaAncho) {
        problemas.push(`${m.label}: ancho de tabla ${m.tablaAncho} vs ${base.tablaAncho}`);
      }
      if (m.contAlto !== base.contAlto) {
        problemas.push(`${m.label}: alto de contenedor ${m.contAlto} vs ${base.contAlto}`);
      }
    }

    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ la tabla de pedidos mantiene el tamaño entre filtros');
    process.exitCode = problemas.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-orders-measure-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
