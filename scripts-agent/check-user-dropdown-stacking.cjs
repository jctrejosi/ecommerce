/**
 * Verifica que el dropdown del botón de usuario quede POR ENCIMA del contenido
 * (encabezados sticky de las tablas) en todas las pestañas.
 *
 * Método: con el menú abierto, para varios puntos dentro del dropdown,
 * `document.elementFromPoint` debe devolver un elemento DEL dropdown. Si devuelve
 * un `th`/`td` de la tabla, el dropdown está por debajo (bug).
 *
 * Uso: node scripts-agent/check-user-dropdown-stacking.cjs [usuario] [clave]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9489);
const USUARIO = process.argv[2] || 'admin.tid1';
const CLAVE = process.argv[3] || 'admin123';
const OUT_DIR = path.join(__dirname, '.scratch');
const USER_DIR = `/tmp/chrome-userdd-${Date.now()}`;

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
    } catch {}
    await esperar(250);
  }
  throw new Error('sin devtools');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--no-first-run',
    '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1500,900', `--user-data-dir=${USER_DIR}`, 'about:blank',
  ], { stdio: 'ignore' });

  let exitCode = 1;
  try {
    const ws = new WebSocket(await esperarDevtools());
    let id = 0;
    const pend = new Map();
    const errores = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? {}); pend.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.text ?? 'excepción');
    });
    const enviar = (method, params = {}) => new Promise((res) => {
      const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    });
    const evaluar = async (expr) => {
      const { result } = await enviar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return result?.value;
    };
    const esperarSelector = async (sel, n = 100) => {
      for (let i = 0; i < n; i++) { if (await evaluar(`!!document.querySelector(${JSON.stringify(sel)})`)) return true; await esperar(400); }
      return false;
    };

    await new Promise((r) => ws.addEventListener('open', r));
    await enviar('Page.enable'); await enviar('Runtime.enable');
    await enviar('Page.navigate', { url: URL });
    await esperarSelector('input[autocomplete="username"]');
    await evaluar(`(() => {
      const set=(s,v)=>{const el=document.querySelector(s);const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;d.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
      set('input[autocomplete="username"]', ${JSON.stringify(USUARIO)});
      set('input[autocomplete="current-password"]', ${JSON.stringify(CLAVE)});
      document.querySelector('button[type="submit"]').click();
      return true;
    })()`);
    await esperarSelector('header img', 140);
    await esperar(3000);

    for (const tab of ['Pedidos', 'Repartidores', 'Mapa']) {
      await evaluar(`(() => {
        const b=[...document.querySelectorAll('nav button')].find(x=>x.textContent.trim()===${JSON.stringify(tab)});
        if(b)b.click(); return !!b;
      })()`);
      await esperar(2600);
      await evaluar(`(() => {
        const b=[...document.querySelectorAll('header button')].find(x=>/Cuenta y tema/.test(x.getAttribute('title')||''));
        if(b)b.click(); return !!b;
      })()`);
      await esperar(700);

      const res = await evaluar(`(() => {
        const dd = [...document.querySelectorAll('div')].find(d => /w-64/.test(d.className) && /Mi perfil/.test(d.textContent||''));
        if (!dd) return JSON.stringify({ found:false });
        const r = dd.getBoundingClientRect();
        const cx = Math.round(r.x + r.width/2);
        const ys = [Math.round(r.y+18), Math.round(r.y+r.height*0.45), Math.round(r.bottom-18)];
        const samples = ys.map((y) => {
          const el = document.elementFromPoint(cx, y);
          return { y, withinDropdown: !!el && dd.contains(el), hit: el ? el.tagName + '.' + String(el.className).slice(0,44) : null };
        });
        return JSON.stringify({ found:true, tab:${JSON.stringify(tab)}, rect:{x:Math.round(r.x),y:Math.round(r.y),h:Math.round(r.height)}, samples });
      })()`);
      const d = JSON.parse(res);
      if (!d.found) {
        check(`${tab}: el dropdown se abre`, false);
      } else {
        const allWithin = d.samples.every((s) => s.withinDropdown);
        check(`${tab}: el dropdown queda por encima del contenido`, allWithin, JSON.stringify(d.samples));
      }

      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) fs.writeFileSync(path.join(OUT_DIR, `userdd-${tab}.png`), Buffer.from(shot.data, 'base64'));

      await evaluar(`(() => { const b=[...document.querySelectorAll('header button')].find(x=>/Cuenta y tema/.test(x.getAttribute('title')||'')); if(b)b.click(); return true; })()`);
      await esperar(500);
    }

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(fallos === 0 ? '✅ dropdown por encima en todas las pestañas' : `❌ ${fallos} problema(s)`);
    ws.close();
    await esperar(300);
    exitCode = fallos === 0 && errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(USER_DIR, { recursive: true, force: true });
    process.exit(exitCode);
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
