/**
 * Verifica que la capa "Waze Oscuro" ya no está en el selector de capas del
 * mapa y que un usuario que la tuviera guardada cae a la capa por defecto
 * ("Calles (móvil)") sin romper el mapa.
 *
 * Uso: node scripts-agent/check-map-layers-nodark.cjs [puerto]
 * Requiere: usuario QA temporal (create-qa-admin.cjs) y el panel corriendo.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9487;
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
      '--user-data-dir=/tmp/chrome-layers-nodark-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const problemas = [];
  const errores = [];

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();

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

    /** Nombres y capa activa del panel de capas. */
    const leerPanel = async () => {
      await evaluar(`document.querySelector('button[title="Cambiar estilo del mapa"]')?.click(); true`);
      await esperar(600);
      const data = JSON.parse(
        await evaluar(`(() => {
          const titulo = [...document.querySelectorAll('p')].find(
            (p) => p.textContent.trim() === 'Estilo del mapa');
          const cont = titulo?.parentElement;
          if (!cont) return JSON.stringify({ nombres: [], activa: null });
          const botones = [...cont.querySelectorAll('button')];
          const activa = botones.find((b) => b.querySelector('svg.lucide-check'));
          return JSON.stringify({
            nombres: botones.map((b) => b.innerText.trim()),
            activa: activa ? activa.innerText.trim() : null,
          });
        })()`),
      );
      // Cerrar el panel.
      await evaluar(`document.querySelector('button[title="Cambiar estilo del mapa"]')?.click(); true`);
      await esperar(300);
      return data;
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
    if (!(await esperarSelector('button[title="Cambiar estilo del mapa"]', 120))) {
      throw new Error(`no entró al panel: ${await evaluar('document.body.innerText.slice(0,150)')}`);
    }
    await esperar(3000);

    console.log('[2] leer las capas disponibles');
    const panel = await leerPanel();
    console.log(`[3] capas: ${JSON.stringify(panel.nombres)}`);
    console.log(`[4] capa activa: ${panel.activa}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'layers-nodark.png'), Buffer.from(shot.data, 'base64'));
    }

    // ── Migración: un usuario con 'waze-dark' guardado ──
    console.log('[5] simular usuario con "waze-dark" guardado y recargar');
    await evaluar(`localStorage.setItem('delivery_admin_map_layer_v5', 'waze-dark'); true`);
    await enviar('Page.reload');
    if (!(await esperarSelector('button[title="Cambiar estilo del mapa"]', 120))) {
      throw new Error('no volvió el panel tras recargar');
    }
    await esperar(5000);
    const trasMigrar = await leerPanel();
    const mapaRoto = await evaluar(
      `document.body.innerText.includes('No se pudieron cargar')`,
    );
    console.log(`[6] tras el guardado viejo → activa: ${trasMigrar.activa} · error visible: ${mapaRoto}`);

    // ── Assertions ──
    if (panel.nombres.includes('Waze Oscuro')) problemas.push('"Waze Oscuro" sigue en el selector');
    if (!panel.nombres.includes('Waze')) problemas.push('la capa "Waze" desapareció');
    if (panel.activa !== 'Calles (móvil)') {
      problemas.push(`la capa activa por defecto debería ser "Calles (móvil)": ${panel.activa}`);
    }
    if (trasMigrar.activa !== 'Calles (móvil)') {
      problemas.push(`con "waze-dark" guardado no cayó a "Calles (móvil)": ${trasMigrar.activa}`);
    }
    if (mapaRoto) problemas.push('el mapa muestra error tras la migración');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ capa "Waze Oscuro" eliminada y migración OK');
    process.exitCode = problemas.length || errores.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-layers-nodark-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
