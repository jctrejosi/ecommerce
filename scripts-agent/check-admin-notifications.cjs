/**
 * Comprueba, en un Chromium headless, lo que necesita el aviso del navegador
 * en el panel de delivery:
 *
 *   1. la página carga sin errores de JS (el módulo de notificaciones importa
 *      bien y la app arranca),
 *   2. si el contexto es seguro y existe `Notification` en cada origen con el
 *      que se puede abrir el panel (localhost vs IP de la red local),
 *   3. que `new Notification(...)` funciona con el permiso concedido.
 *
 * Uso: node scripts-agent/check-admin-notifications.cjs [puerto] [ip]
 */
const { spawn } = require('node:child_process');

const PORT = process.argv[2] || '8447';
const IP = process.argv[3] || '192.168.0.132';
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9333;
const ORIGENES = [
  { etiqueta: 'localhost', url: `http://localhost:${PORT}/` },
  { etiqueta: `IP ${IP}`, url: `http://${IP}:${PORT}/` },
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarDevtools() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* aún no está listo */
    }
    await esperar(250);
  }
  throw new Error('no se pudo conectar al puerto de depuración de Chromium');
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
      '--user-data-dir=/tmp/chrome-notif-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const wsUrl = await esperarDevtools();
    const ws = new WebSocket(wsUrl);
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

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Browser.grantPermissions', {
      origin: ORIGENES[0].url.replace(/\/$/, ''),
      permissions: ['notifications'],
    });

    for (const origen of ORIGENES) {
      await enviar('Page.navigate', { url: origen.url });
      await esperar(3500);
      const { result } = await enviar('Runtime.evaluate', {
        expression: `JSON.stringify({
          secure: window.isSecureContext,
          tieneApi: 'Notification' in window,
          permiso: 'Notification' in window ? Notification.permission : 'n/a',
          titulo: document.title,
          raizVacia: (document.getElementById('root') || {}).childElementCount === 0,
        })`,
        returnByValue: true,
      });
      const datos = JSON.parse(result.value);
      console.log(`\n[${origen.etiqueta}] ${origen.url}`);
      console.log(`  contexto seguro : ${datos.secure}`);
      console.log(`  API Notification: ${datos.tieneApi}  permiso: ${datos.permiso}`);
      console.log(`  página          : "${datos.titulo}"`);
      console.log(`  montó la app    : ${datos.raizVacia ? 'NO (raíz vacía)' : 'sí'}`);

      if (datos.tieneApi && datos.permiso === 'granted') {
        const { result: prueba } = await enviar('Runtime.evaluate', {
          expression: `(() => {
            try {
              const n = new Notification('Prueba Delivery Admin', { body: 'sonda automática' });
              n.close();
              return 'ok';
            } catch (e) { return 'error: ' + e.message; }
          })()`,
          returnByValue: true,
        });
        console.log(`  new Notification: ${prueba.value}`);
      }
    }

    console.log(`\nerrores de consola: ${errores.length}`);
    for (const e of errores.slice(0, 8)) console.log(`  · ${e.slice(0, 160)}`);
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
