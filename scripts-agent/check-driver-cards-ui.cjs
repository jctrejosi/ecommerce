/**
 * Verifica que las fichas de repartidores del mapa ya no tengan el switch de
 * disponibilidad (ni en la fila ni en la ficha de detalle), y deja capturas.
 *
 * Uso: node scripts-agent/check-driver-cards-ui.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9387;
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
      '--user-data-dir=/tmp/chrome-cards-probe',
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
    const capturar = async (nombre) => {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) fs.writeFileSync(path.join(OUT, nombre), Buffer.from(shot.data, 'base64'));
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
    await esperar(3500);

    // Las fichas son filas clicables (`div.cursor-pointer`) que contienen el
    // botón "Ocultar del mapa". Se ancla el scope en la primera de ellas.
    const encontrado = await evaluar(`(() => {
      const btn = document.querySelector('button[title="Ocultar del mapa"]');
      const row = btn && btn.closest('div.cursor-pointer');
      if (!row) return false;
      window.__row = row;
      window.__side = row.parentElement;
      return true;
    })()`);
    if (!encontrado) throw new Error('no se encontraron fichas de repartidores en el mapa');

    const lista = await evaluar(`(() => {
      const side = window.__side;
      if (!side) return JSON.stringify({ error: 'no se encontró el sidebar' });
      const switches = side.querySelectorAll('[role="switch"]').length;
      const textos = [...side.querySelectorAll('button')].map((b) =>
        (b.innerText || b.getAttribute('title') || '?').replace(/\\s+/g, ' ').trim().slice(0, 28),
      );
      return JSON.stringify({
        switchesEnSidebar: switches,
        botonesEnSidebar: textos.length,
        textos,
        textoDisponibilidad: side.innerText.includes('Disponibilidad'),
      }, null, 1);
    })()`);
    console.log(`[2] lista del mapa: ${lista}`);
    await capturar('cards-lista.png');

    // Abrir la ficha de detalle de la primera ficha.
    const abierto = await evaluar(`(() => {
      const row = window.__row;
      if (!row) return false;
      row.click();
      return true;
    })()`);
    await esperar(1500);
    // Re-consultar el DOM: al abrir la ficha, React reemplaza el nodo del listado.
    const detalle = await evaluar(`(() => {
      const texto = document.body.innerText;
      const detalleAbierto = texto.includes('Volver a la flota');
      // La ficha de detalle es el contenedor de "Volver a la flota".
      const volver = [...document.querySelectorAll('button')].find((b) =>
        b.innerText.includes('Volver a la flota'),
      );
      const ficha = volver ? volver.parentElement?.parentElement : null;
      return JSON.stringify({
        detalleAbierto,
        switchesEnPagina: document.querySelectorAll('[role="switch"]').length,
        switchesEnDetalle: ficha ? ficha.querySelectorAll('[role="switch"]').length : 0,
        textoDisponibilidad: texto.includes('Disponibilidad'),
        tieneOcupacion: texto.includes('Ocupación'),
      });
    })()`);
    console.log(`[3] ficha de detalle (abierta=${abierto}): ${detalle}`);
    await capturar('cards-detalle.png');

    const d = JSON.parse(detalle);
    const l = JSON.parse(lista);
    const problemas = [];
    if (l.switchesEnSidebar) problemas.push(`quedan ${l.switchesEnSidebar} switches en la lista`);
    if (l.textoDisponibilidad) problemas.push('la lista aún muestra "Disponibilidad"');
    if (d.switchesEnDetalle || d.switchesEnPagina) {
      problemas.push(`quedan ${d.switchesEnPagina} switches en la página`);
    }
    if (d.textoDisponibilidad) problemas.push('la vista aún muestra "Disponibilidad"');
    if (!d.detalleAbierto) problemas.push('el detalle no se abrió');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ sin switches de disponibilidad en el mapa');
    ws.close();
    process.exitCode = problemas.length || errores.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-cards-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
