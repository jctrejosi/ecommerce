/**
 * Verifica la cabecera de la tabla de Repartidores: fondo BLANCO y opaco,
 * incluso con la tabla desplazada (la cabecera es `position: sticky`).
 *
 * Uso: node scripts-agent/check-drivers-table-header.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9437;
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
      '--window-size=1400,760',
      '--user-data-dir=/tmp/chrome-thead-probe',
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
    await esperar(2500);

    console.log('[2] abriendo la pestaña Repartidores');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Repartidores',
      );
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(2500);

    const medir = `(() => {
      const th = document.querySelector('thead th');
      const tr = document.querySelector('thead tr');
      const cont = th?.closest('div');
      if (!th) return JSON.stringify({ error: 'sin cabecera de tabla' });
      const rc = cont.getBoundingClientRect();
      const rt = th.getBoundingClientRect();
      const fila = tr.getBoundingClientRect();
      // Muestreo a lo ancho de TODA la cabecera: si alguna fila se pinta por
      // encima, elementFromPoint devolverá algo que no es TH.
      const puntos = [];
      const fallos = [];
      for (const fy of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        for (let i = 0; i <= 20; i++) {
          const x = fila.left + 2 + ((fila.width - 4) * i) / 20;
          const y = fila.top + fila.height * fy;
          const el = document.elementFromPoint(x, y);
          puntos.push(el ? el.tagName : 'null');
          if (!el || (el.tagName !== 'TH' && el.tagName !== 'TR' && el.tagName !== 'THEAD')) {
            fallos.push(
              Math.round(x) + ',' + Math.round(y) + '=' +
              (el ? el.tagName + '.' + String(el.className).slice(0, 24) : 'null'),
            );
          }
        }
      }
      return JSON.stringify({
        thBg: getComputedStyle(th).backgroundColor,
        trBg: getComputedStyle(tr).backgroundColor,
        trZ: getComputedStyle(tr).zIndex,
        altoCabecera: Math.round(fila.height),
        topCabecera: Math.round(fila.top),
        pegadoArriba: Math.abs(rt.top - rc.top) < 2,
        intrusos: fallos.length,
        detalleIntrusos: fallos.slice(0, 6),
        scrollTop: cont.scrollTop,
      });
    })()`;

    console.log(`[3] cabecera sin desplazar: ${await evaluar(medir)}`);

    // Desplazar la tabla y volver a medir: la cabecera debe seguir pegada,
    // opaca y por encima de las filas.
    await evaluar(`(() => {
      const cont = document.querySelector('thead th').closest('div');
      cont.scrollTop = 240;
      return cont.scrollTop;
    })()`);
    await esperar(700);
    const tras = await evaluar(medir);
    console.log(`[4] cabecera tras desplazar: ${tras}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'drivers-thead.png'), Buffer.from(shot.data, 'base64'));
    }
    // Recorte ampliado de la cabecera, para revisarla de cerca.
    const rect = JSON.parse(tras);
    if (rect.topCabecera != null) {
      const clip = await enviar('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: 10,
          y: Math.max(0, rect.topCabecera - 6),
          width: 1380,
          height: rect.altoCabecera + 50,
          scale: 2,
        },
      });
      if (clip?.data) {
        fs.writeFileSync(path.join(OUT, 'drivers-thead-zoom.png'), Buffer.from(clip.data, 'base64'));
      }
    }

    // Prueba diferencial: si la zona de la cabecera cambia al ocultar el
    // cuerpo de la tabla, es que algo de las filas se está viendo a través.
    const clipCabecera = {
      x: 12,
      y: rect.topCabecera,
      width: 1360,
      height: rect.altoCabecera,
      scale: 1,
    };
    const conFilas = (await enviar('Page.captureScreenshot', { format: 'png', clip: clipCabecera }))?.data;
    // Control: una banda dentro del cuerpo de la tabla DEBE cambiar al ocultarlo.
    const clipControl = {
      x: 12,
      y: rect.topCabecera + rect.altoCabecera + 40,
      width: 1360,
      height: 80,
      scale: 1,
    };
    const controlConFilas = (await enviar('Page.captureScreenshot', { format: 'png', clip: clipControl }))?.data;
    await evaluar(`(() => {
      document.querySelector('tbody').style.visibility = 'hidden';
      return true;
    })()`);
    await esperar(500);
    const sinFilas = (await enviar('Page.captureScreenshot', { format: 'png', clip: clipCabecera }))?.data;
    const controlSinFilas = (await enviar('Page.captureScreenshot', { format: 'png', clip: clipControl }))?.data;
    await evaluar(`(() => {
      document.querySelector('tbody').style.visibility = '';
      return true;
    })()`);

    const bleed = conFilas !== sinFilas;
    const controlOk = controlConFilas !== controlSinFilas;
    if (conFilas) {
      fs.writeFileSync(path.join(OUT, 'thead-exacta.png'), Buffer.from(conFilas, 'base64'));
    }
    if (sinFilas) {
      fs.writeFileSync(path.join(OUT, 'thead-exacta-sin-filas.png'), Buffer.from(sinFilas, 'base64'));
    }
    // Banda equivalente justo DEBAJO de la cabecera: si el texto de las filas
    // aparece aquí y no en la banda de la cabecera, todo está en orden.
    const debajo = await enviar('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 12, y: rect.topCabecera + rect.altoCabecera, width: 1360, height: rect.altoCabecera, scale: 1 },
    });
    if (debajo?.data) {
      fs.writeFileSync(path.join(OUT, 'thead-debajo.png'), Buffer.from(debajo.data, 'base64'));
    }

    const geo = await evaluar(`(() => {
      const th = document.querySelector('thead th');
      const fila = document.querySelector('thead tr').getBoundingClientRect();
      const filas = [...document.querySelectorAll('tbody tr')].slice(0, 2).map((tr) => {
        const r = tr.getBoundingClientRect();
        // textos y elementos posicionados de la fila
        const hijos = [...tr.querySelectorAll('td, td *')]
          .map((el) => {
            const b = el.getBoundingClientRect();
            return { tag: el.tagName, top: Math.round(b.top), bottom: Math.round(b.bottom), texto: (el.textContent || '').trim().slice(0, 18) };
          })
          .filter((b) => b.bottom > 0 && b.top < fila.bottom);
        return { filaTop: Math.round(r.top), filaBottom: Math.round(r.bottom), hijos: hijos.slice(0, 4) };
      });
      return JSON.stringify({
        cabecera: { top: Math.round(fila.top), bottom: Math.round(fila.bottom), alto: Math.round(fila.height) },
        filas,
      }, null, 1);
    })()`);
    console.log(`[5] geometr铆a tras el scroll:\n${geo}`);

    const d = JSON.parse(tras);
    const problemas = [];
    if (d.error) problemas.push(d.error);
    if (d.thBg !== 'rgb(255, 255, 255)') problemas.push(`fondo de la cabecera: ${d.thBg}`);
    if (d.trZ === 'auto') problemas.push('el <tr> sticky no tiene z-index propio');
    if (!d.pegadoArriba) problemas.push('la cabecera dejó de ser sticky al desplazar');
    if (d.intrusos > 0) problemas.push(`hay ${d.intrusos}/11 puntos de la cabecera cubiertos por filas`);
    if (d.scrollTop === 0) problemas.push('la tabla no se desplazó (prueba poco concluyente)');

    if (bleed) problemas.push('la zona de la cabecera cambia al ocultar las filas (sangrado)');
    if (!controlOk) problemas.push('control inválido: ocultar el tbody no cambió la zona de filas');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(
      `prueba diferencial: cabecera ${bleed ? 'CAMBIÁ' : 'idéntica'} · control ${controlOk ? 'ok (cambió)' : 'INVÁLIDO'}`,
    );
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ cabecera blanca, opaca y fija');
    ws.close();
    process.exitCode = problemas.length || errores.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-thead-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
