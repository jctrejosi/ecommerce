/**
 * Verifica que el mapa del panel delivery-admin reintenta cargarse solo cuando
 * el estilo/tiles fallan, en lugar de mostrar el error de inmediato:
 *   - bloqueando el estilo (openfreemap / proxy /ofm) se ven los reintentos,
 *   - mientras reintenta, la pantalla de carga dice "Reintentando conexión…",
 *   - solo tras agotar los intentos aparece el aviso de error.
 *
 * Uso: node scripts-agent/check-map-autoretry.cjs [usuario] [clave]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9491);
const USUARIO = process.argv[2] || 'admin.tid1';
const CLAVE = process.argv[3] || 'admin123';
const USER_DIR = `/tmp/chrome-map-retry-${Date.now()}`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
function check(name, ok, detail = '') {
  if (!ok) fallos += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function esperarDevtools() {
  for (let i = 0; i < 80; i++) {
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
      '--window-size=1600,950',
      `--user-data-dir=${USER_DIR}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();
    const consolas = [];
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
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? '')
          .join(' ');
        consolas.push(`[${msg.params.type}] ${text}`);
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
    const esperarSelector = async (selector, intentos = 100) => {
      for (let i = 0; i < intentos; i++) {
        if (await evaluar(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
        await esperar(400);
      }
      return false;
    };

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Network.enable');

    // Bloquea el ESTILO empaquetado para forzar el fallo de resolveStyle y
    // comprobar los reintentos (si NO_BLOCK=1 se ejecuta con red normal).
    if (process.env.NO_BLOCK !== '1') {
      await enviar('Network.setBlockedURLs', {
        urls: ['*map/styles*'],
      });
    }

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
    if (!(await esperarSelector('header img', 140))) throw new Error('no entró al panel');

    // Muestrea la pantalla de carga durante los reintentos (~14 s).
    const vistos = new Set();
    let overlayError = false;
    for (let i = 0; i < 34; i++) {
      const txt = await evaluar(`document.body.innerText`);
      if (typeof txt === 'string') {
        if (txt.includes('Reintentando conexión')) vistos.add('Reintentando conexión…');
        if (txt.includes('Cargando mapa')) vistos.add('Cargando mapa…');
        if (txt.includes('El mapa no se pudo mostrar')) overlayError = true;
      }
      await esperar(450);
    }

    const reintentos = consolas.filter((c) => /reintento \d+\/5/.test(c));
    console.log(`\nreintentos detectados: ${reintentos.length}`);
    reintentos.forEach((r) => console.log(`   ${r}`));
    console.log(`pantallas de carga vistas: ${[...vistos].join(' | ')}`);

    check('no se mostró el error al primer fallo', reintentos.length > 0);
    check(
      'mientras reintenta, la carga dice "Reintentando conexión…"',
      vistos.has('Reintentando conexión…'),
    );
    check('se agotaron los intentos (>=4 reintentos)', reintentos.length >= 4, `n=${reintentos.length}`);
    check('tras agotar intentos aparece el aviso de error', overlayError);

    console.log(
      `\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`,
    );
    console.log(fallos === 0 ? '✅ reintento automático del mapa ok' : `❌ ${fallos} verificación(es) con problemas`);
    ws.close();
    await esperar(300);
    process.exitCode = fallos === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(USER_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
