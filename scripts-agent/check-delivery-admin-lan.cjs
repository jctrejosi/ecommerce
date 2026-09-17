/**
 * Verifica que el panel de delivery admin funcione abierto **desde la red local**
 * (no solo en localhost): abre `http://<ip-lan>:8447` en un Chromium headless,
 * inicia sesión y registra a qué host van las llamadas al API.
 *
 * Si el panel siguiera resolviendo el API contra `localhost`, el navegador (que
 * corre en el equipo servidor) respondería igual, así que la comprobación real
 * es mirar la URL de las peticiones: deben apuntar a la IP de LAN, no a
 * `localhost`. Eso es lo que rompería al abrirlo desde el celular.
 *
 * Uso: node scripts-agent/check-delivery-admin-lan.cjs [ip-lan] [puerto]
 */
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9335;

function lanIp() {
  const virtual = /^(docker|br-|veth|virbr|vmnet|tun|tap|utun|wg)/i;
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      found.push(a.address);
    }
  }
  const rank = (ip) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const IP = process.argv[2] || process.env.LAN_IP || lanIp();
const PORT = process.argv[3] || '8447';
const ORIGIN = `http://${IP}:${PORT}`;
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
  if (!IP) throw new Error('no se detectó IP de LAN');

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
      '--window-size=1440,900',
      '--user-data-dir=/tmp/chrome-lan-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pendientes = new Map();
    const peticiones = [];
    const errores = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendientes.has(msg.id)) {
        pendientes.get(msg.id)(msg.result ?? {});
        pendientes.delete(msg.id);
        return;
      }
      if (msg.method === 'Network.requestWillBeSent') {
        peticiones.push(msg.params.request.url);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        errores.push(msg.params.exceptionDetails.text ?? 'excepción');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errores.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
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
    await enviar('Network.enable');

    console.log(`[1] abriendo ${ORIGIN}`);
    await enviar('Page.navigate', { url: `${ORIGIN}/` });
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

    console.log('[3] esperando el mapa…');
    await esperarSelector('.maplibregl-map', 120);
    await esperar(3000);

    const apiReqs = peticiones.filter((u) => /\/\/([^/]+)\/?(?:delivery|auth|admin)\//.test(u) || u.includes(':3000/'));
    const hosts = [...new Set(apiReqs.map((u) => new URL(u).host))];
    const localhostHits = apiReqs.filter((u) => /\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u));
    const lanHits = apiReqs.filter((u) => u.startsWith(`http://${IP}:3000`));

    console.log(`[4] peticiones al API observadas: ${apiReqs.length}`);
    console.log(`    hosts usados: ${hosts.join(', ') || '(ninguno)'}`);
    console.log(`    hacia la IP de LAN (${IP}:3000): ${lanHits.length}`);
    console.log(`    hacia localhost: ${localhostHits.length}`);
    for (const u of apiReqs.filter((u) => u.includes(':3000')).slice(0, 5)) {
      console.log(`      · ${u.slice(0, 110)}`);
    }

    const mapa = await evaluar(`!!document.querySelector('.maplibregl-map')`);
    const ok = Boolean(mapa) && lanHits.length > 0 && localhostHits.length === 0;
    console.log(`\nRESULTADO: ${ok ? 'OK (el panel corre desde la LAN y llama al API en la LAN)' : 'FALLO'}`);
    console.log(`errores de consola: ${errores.length}`);
    for (const e of errores.slice(0, 6)) console.log(`  · ${e.slice(0, 160)}`);

    ws.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
