/**
 * Verifica que, sin tema guardado (localStorage vacío), el panel tome el modo
 * del sistema vía `prefers-color-scheme`.
 * Uso: node scripts-agent/check-default-theme-system.cjs
 */
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9391;

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('no se pudo abrir el socket CDP')));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send };
}

async function main() {
  const chrome = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--window-size=1200,900', `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=/tmp/cdp-theme-${Date.now()}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets.find((t) => t.type === 'page');
    const { ready, send } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });

    const read = async () => {
      const r = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          mode: document.documentElement.dataset.mode,
          theme: document.documentElement.dataset.theme,
          saved: localStorage.getItem('picking-admin-theme'),
          prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        })`,
        returnByValue: true,
      });
      return JSON.parse(r.result.value);
    };

    const nav = async () => {
      await send('Page.navigate', { url: PANEL_URL });
      // espera a que corra initTheme (dataset.mode presente)
      for (let i = 0; i < 40; i++) {
        const ok = await send('Runtime.evaluate', {
          expression: `!!document.documentElement.dataset.mode && document.body != null`,
          returnByValue: true,
        });
        if (ok.result.value) break;
        await sleep(200);
      }
      await sleep(300);
    };

    await nav();
    const light = await read();
    console.log('Sistema CLARO  ->', JSON.stringify(light));
    const okLight = light.mode === 'light' && light.saved === null;

    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
    await nav();
    const dark = await read();
    console.log('Sistema OSCURO ->', JSON.stringify(dark));
    const okDark = dark.mode === 'dark' && dark.saved === null;

    console.log(okLight && okDark
      ? 'OK: por defecto sigue el tema del sistema (sin tema guardado)'
      : 'FALLO: el default no sigue prefers-color-scheme');
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
