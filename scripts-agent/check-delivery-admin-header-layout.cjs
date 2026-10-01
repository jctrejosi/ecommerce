/**
 * Verifica el layout del header del panel de delivery admin y las cifras de
 * flota sobre el mapa (esquina superior derecha), a varias resoluciones.
 *
 * Comprueba, en cada ancho:
 *   - el bloque de marca (logo + "Delivery") no se desborda ni se solapa con el nav,
 *   - la altura real del header (debe crecer, no recortar),
 *   - los chips de flota están dentro del contenedor del mapa y pegados a la derecha,
 *   - la posición del primer chip respecto al borde superior del mapa.
 *
 * Uso: node scripts-agent/check-delivery-admin-header-layout.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9362;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
const OUT_DIR = path.join(__dirname, '.scratch');
const ANCHOS = [1024, 1280, 1440, 1600];

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
      '--window-size=1600,900',
      '--user-data-dir=/tmp/chrome-hdr-probe',
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

    if (!(await esperarSelector('header img', 120))) {
      throw new Error('no entró al panel');
    }
    await esperar(3000);

    let fallos = 0;
    for (const ancho of ANCHOS) {
      console.log(`\n=== ancho ${ancho}px ===`);
      await enviar('Emulation.setDeviceMetricsOverride', {
        width: ancho,
        height: 860,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // Recargar para que el mapa (MapLibre) se dimensione al nuevo viewport:
      // un cambio de tamaño en caliente deja el lienzo con el tamaño anterior.
      await enviar('Page.reload');
      await esperarSelector('header img', 120);
      await esperar(3500);

      const info = await evaluar(`(() => {
        const header = document.querySelector('header');
        const marca = header.querySelector('p')?.parentElement;
        const nav = header.querySelector('nav');
        const mapas = [...document.querySelectorAll('main > div.relative')];
        const mapa = mapas[0];
        const chips = mapa ? [...mapa.querySelectorAll('div.absolute')].find((d) => /en entrega|con pedido|desconectados/.test(d.innerText)) : null;
        const chipList = chips ? [...chips.querySelectorAll('span')].map((s) => s.innerText.trim()) : [];
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
        const hb = r(header), mb = r(marca), nb = r(nav), cb = r(chips), mpb = r(mapa);
        return JSON.stringify({
          headerH: hb.h,
          marca: mb, nav: nb,
          marcaDentroDelHeader: mb && hb ? mb.bottom <= hb.bottom + 1 : null,
          marcaSolapaNav: mb && nb ? mb.right > nb.x : null,
          tituloMarca: marca ? marca.querySelector('p')?.innerText.trim() : null,
          subtituloSigue: document.body.innerText.includes('Seguimiento de flota'),
          chipTextos: chipList,
          chipsDentroDelMapa: cb && mpb ? cb.right <= mpb.right + 1 && cb.y >= mpb.y - 1 : null,
          chipRight: cb ? mpb.right - cb.right : null,
          chipTop: cb && mpb ? cb.y - mpb.y : null,
        });
      })()`);
      const d = JSON.parse(info);
      console.log(JSON.stringify(d, null, 1));

      const problemas = [];
      if (d.marcaDentroDelHeader !== true) problemas.push('la marca se desborda del header');
      if (d.marcaSolapaNav !== false) problemas.push('la marca se solapa con el nav');
      if (d.subtituloSigue) problemas.push('aún aparece "Seguimiento de flota"');
      if (d.chipsDentroDelMapa !== true) problemas.push('los chips no están dentro del mapa');
      if (d.chipRight != null && d.chipRight > 20) problemas.push(`los chips no están pegados a la derecha (${d.chipRight}px)`);
      if (d.chipTop != null && d.chipTop > 30) problemas.push(`los chips no están arriba (${d.chipTop}px)`);
      if (problemas.length) {
        fallos++;
        console.log(`  ⚠️  ${problemas.join(' · ')}`);
      } else {
        console.log('  ✅ layout ok');
      }

      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT_DIR, `header-${ancho}.png`), Buffer.from(shot.data, 'base64'));
      }
    }

    await enviar('Emulation.clearDeviceMetricsOverride');
    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(fallos ? `❌ ${fallos} resolución(es) con problemas` : '✅ todas las resoluciones ok');
    console.log(`capturas en scripts-agent/.scratch/header-<ancho>.png`);
    ws.close();
    process.exitCode = fallos === 0 && errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-hdr-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
