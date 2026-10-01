/**
 * Verifica la pestaña "Historial" en la ficha del repartidor (mapa):
 * que existan las dos pestañas, que Historial cargue entregas y que al volver
 * a Detalle se vea el contenido original.
 *
 * Uso: node scripts-agent/check-driver-history-ui.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9469;
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
      '--user-data-dir=/tmp/chrome-hist-probe',
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
    if (!(await esperarSelector('header nav button', 120))) {
      const texto = await evaluar('document.body.innerText.slice(0, 300)');
      const url = await evaluar('location.pathname');
      throw new Error(`no entró al panel (url=${url}). Pantalla: ${texto}`);
    }
    await esperar(4000);

    console.log('[2] abriendo la ficha del primer repartidor del mapa');
    await evaluar(`(() => {
      const btn = document.querySelector('button[title="Ocultar del mapa"]');
      const row = btn && btn.closest('div.cursor-pointer');
      row?.click();
      return Boolean(row);
    })()`);
    await esperar(1800);

    const tabs = await evaluar(`(() => {
      const nombres = ['Detalle', 'Historial'];
      const encontrados = nombres.filter((n) =>
        [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === n),
      );
      return JSON.stringify(encontrados);
    })()`);
    console.log(`[3] pestañas presentes: ${tabs}`);

    const detalle = await evaluar(
      `document.body.innerText.includes('Volver a la flota') ? 'ok' : 'falta'`,
    );
    console.log(`[4] pestaña Detalle visible: ${detalle}`);

    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (n) => n.innerText.trim() === 'Historial',
      );
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(3000);

    const hist = await evaluar(`(() => {
      const texto = document.body.innerText;
      const volver = [...document.querySelectorAll('button')].find((b) =>
        b.innerText.includes('Volver a la flota'),
      );
      const ficha = volver ? volver.parentElement?.parentElement : null;
      const tarjetas = ficha ? [...ficha.querySelectorAll('div.rounded-xl.border')].length : 0;
      const refs = ficha
        ? [...ficha.querySelectorAll('div.rounded-xl.border')]
            .map((d) => (d.querySelector('span')?.innerText ?? '').trim())
            .slice(0, 4)
        : [];
      return JSON.stringify({
        cargando: texto.includes('Cargando historial'),
        vacio: texto.includes('Aún no tiene entregas cerradas'),
        tarjetas,
        refs,
        sigueVolver: texto.includes('Volver a la flota'),
      });
    })()`);
    console.log(`[5] pestaña Historial: ${hist}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'driver-historial.png'), Buffer.from(shot.data, 'base64'));
    }

    // Volver a Detalle.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (n) => n.innerText.trim() === 'Detalle',
      );
      b?.click();
      return Boolean(b);
    })()`);
    // Ojo: `innerText` devuelve el texto ya transformado por CSS, y los títulos
    // de sección llevan `uppercase`.
    const vuelta = await evaluar(
      `(() => {
        const t = document.body.innerText;
        const detalle = t.includes('Ocupación') && t.toUpperCase().includes('COLOR DE LA RUTA EN EL MAPA');
        const historialFuera = !t.includes('Cargando historial');
        return JSON.stringify({ detalle, historialFuera });
      })()`,
    );
    const v = JSON.parse(vuelta);
    console.log(`[6] volver a Detalle: ${vuelta}`);
    if (vuelta !== 'ok') {
      const dbg = await evaluar(`(() => {
        const volver = [...document.querySelectorAll('button')].find((b) =>
          b.innerText.includes('Volver a la flota'),
        );
        const ficha = volver ? volver.parentElement?.parentElement : null;
        const botonesTabs = [...document.querySelectorAll('button')]
          .filter((b) => ['Detalle', 'Historial'].includes(b.innerText.trim()))
          .map((b) => b.innerText.trim() + '|' + (b.className.includes('border-slate-900') ? 'activo' : 'inactivo'));
        return JSON.stringify({
          tabs: botonesTabs,
          fichaTexto: ficha ? ficha.innerText.replace(/\\n/g, ' / ').slice(0, 200) : null,
        });
      })()`);
      console.log(`    diagnóstico: ${dbg}`);
    }

    const t = JSON.parse(tabs);
    const h = JSON.parse(hist);
    const problemas = [];
    if (t.length !== 2) problemas.push(`faltan pestañas (${tabs})`);
    if (detalle !== 'ok') problemas.push('la pestaña Detalle no se abrió');
    if (h.vacio) problemas.push('el historial salió vacío (había entregas en la BD)');
    if (h.tarjetas === 0 && !h.vacio) problemas.push('no se renderizó ninguna tarjeta de historial');
    if (!v.detalle) problemas.push('al volver a Detalle no se ve el contenido');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ pestaña Historial funcionando');
    ws.close();
    process.exitCode = problemas.length || errores.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-hist-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
