/**
 * Verifica que el login del panel delivery-admin siga el tema:
 *  - tema claro  → fondo claro y título con letra oscura,
 *  - tema oscuro → fondo oscuro y título con letra clara.
 *
 * Uso: node scripts-agent/check-login-theme.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9495);
const OUT_DIR = path.join(__dirname, '.scratch');
const USER_DIR = `/tmp/chrome-login-theme-${Date.now()}`;
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

/** Luminancia media (0-255) de un color `rgb(...)` o `color(srgb ...)`. */
function lum(color) {
  if (!color) return null;
  let m = /rgba?\(([^)]+)\)/.exec(color);
  if (m) {
    const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
    return (r + g + b) / 3;
  }
  m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(color);
  if (m) {
    return ((parseFloat(m[1]) + parseFloat(m[2]) + parseFloat(m[3])) / 3) * 255;
  }
  return null;
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
      '--window-size=1400,900',
      `--user-data-dir=${USER_DIR}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) {
        pend.get(m.id)(m.result ?? {});
        pend.delete(m.id);
      }
    });
    const enviar = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id;
        pend.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const ev = async (e) => {
      let ultimo = null;
      for (let i = 0; i < 12; i++) {
        try {
          const { result, exceptionDetails } = await enviar('Runtime.evaluate', {
            expression: e,
            returnByValue: true,
            awaitPromise: true,
          });
          if (exceptionDetails) throw new Error(exceptionDetails.text);
          return result?.value;
        } catch (err) {
          ultimo = err;
          await esperar(250);
        }
      }
      throw ultimo ?? new Error('evaluate falló');
    };
    const esperarLogin = async () => {
      for (let i = 0; i < 80; i++) {
        try {
          if (await ev(`!!document.querySelector('input[autocomplete="username"]')`)) return true;
        } catch {
          /* contexto en navegación */
        }
        await esperar(300);
      }
      return false;
    };

    await new Promise((r) => ws.addEventListener('open', r));
    await enviar('Page.enable');
    await enviar('Runtime.enable');

    const medir = async (tema) => {
      await enviar('Page.navigate', { url: URL });
      if (!(await esperarLogin())) throw new Error('no apareció el login (1)');
      await ev(`localStorage.setItem('delivery_admin_theme', ${JSON.stringify(tema)})`);
      await enviar('Page.navigate', { url: URL });
      if (!(await esperarLogin())) throw new Error('no apareció el login (2)');
      await esperar(900);
      const datos = await ev(`(() => {
        const bg = document.querySelector('.login-bg');
        const h1 = document.querySelector('.login-bg h1');
        return JSON.stringify({
          theme: document.documentElement.dataset.theme,
          bg: bg ? getComputedStyle(bg).backgroundColor : null,
          title: h1 ? getComputedStyle(h1).color : null,
          formBg: (() => { const f = document.querySelector('form'); return f ? getComputedStyle(f).backgroundColor : null; })(),
        });
      })()`);
      const d = JSON.parse(datos);
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT_DIR, `login-${tema}.png`), Buffer.from(shot.data, 'base64'));
      }
      return d;
    };

    const claro = await medir('light');
    const oscuro = await medir('dark');
    console.log('claro :', JSON.stringify(claro));
    console.log('oscuro:', JSON.stringify(oscuro));

    const bgClaro = lum(claro.bg);
    const titleClaro = lum(claro.title);
    const bgOscuro = lum(oscuro.bg);
    const titleOscuro = lum(oscuro.title);

    check('tema claro activo', claro.theme === 'light');
    check('fondo del login claro', bgClaro != null && bgClaro > 190, `lum=${bgClaro?.toFixed(0)}`);
    check('título oscuro en tema claro', titleClaro != null && titleClaro < 90, `lum=${titleClaro?.toFixed(0)}`);

    check('tema oscuro activo', oscuro.theme === 'dark');
    check('fondo del login oscuro', bgOscuro != null && bgOscuro < 70, `lum=${bgOscuro?.toFixed(0)}`);
    check('título claro en tema oscuro', titleOscuro != null && titleOscuro > 180, `lum=${titleOscuro?.toFixed(0)}`);

    console.log(fallos === 0 ? '✅ login adaptable al tema ok' : `❌ ${fallos} verificación(es) con problemas`);
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
