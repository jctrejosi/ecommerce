/**
 * Verifica el modal de detalle de pedido del panel delivery-admin:
 *  - al tocar un renglón de la tabla "Pedidos" se abre el modal,
 *  - el modal muestra el mismo código de pedido y las secciones esperadas,
 *  - las acciones (mapa / chat / cerrar) están presentes,
 *  - Escape cierra el modal,
 *  - el botón "Ubicar en el mapa" NO abre el modal (stopPropagation).
 *
 * Uso: node scripts-agent/check-order-detail-modal.cjs [usuario] [clave]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9486);
const USUARIO = process.argv[2] || 'admin.tid1';
const CLAVE = process.argv[3] || 'admin123';
const OUT_DIR = path.join(__dirname, '.scratch');
const USER_DIR = `/tmp/chrome-order-modal-${Date.now()}`;

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
    await esperar(2500);

    // Ir a la pestaña Pedidos.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('nav button')].find((x) => x.textContent.trim() === 'Pedidos');
      if (b) b.click();
      return !!b;
    })()`);
    if (!(await esperarSelector('table tbody tr td p.font-mono', 120))) {
      throw new Error('no cargaron los pedidos de la tabla');
    }
    await esperar(800);

    // Código del primer renglón.
    const refRow = await evaluar(
      `document.querySelector('table tbody tr td p.font-mono')?.textContent.trim() ?? ''`,
    );
    console.log(`\nprimer pedido de la tabla: ${refRow}`);

    // Abrir el modal tocando el renglón.
    await evaluar(`(() => {
      const tr = document.querySelector('table tbody tr');
      tr.click();
      return true;
    })()`);
    const abrio = await esperarSelector('div.fixed.inset-0 h2.font-mono', 60);
    check('al tocar el renglón se abre el modal', abrio);

    const info = await evaluar(`(() => {
      const overlay = document.querySelector('div.fixed.inset-0.z-1000');
      if (!overlay) return JSON.stringify({ found: false });
      const h2 = overlay.querySelector('h2.font-mono');
      const txt = overlay.textContent || '';
      const botones = [...overlay.querySelectorAll('button, a')].map((b) => b.textContent.trim());
      return JSON.stringify({
        found: true,
        titulo: h2 ? h2.textContent.trim() : null,
        secciones: ['Repartidor', 'Cliente', 'Dirección de entrega', 'Tiempos', 'Pago', 'Carga', 'Sucursal'].filter((s) => txt.includes(s)),
        botones,
      });
    })()`);
    const data = JSON.parse(info);
    console.log(JSON.stringify(data, null, 1));

    check('el título del modal coincide con el pedido', data.found && data.titulo === refRow, `modal=${data.titulo} fila=${refRow}`);
    check('incluye la sección Repartidor', data.secciones?.includes('Repartidor'));
    check('incluye la sección Cliente', data.secciones?.includes('Cliente'));
    check('incluye la Dirección de entrega', data.secciones?.includes('Dirección de entrega'));
    check('incluye Tiempos', data.secciones?.includes('Tiempos'));
    check('incluye Pago y Carga', data.secciones?.includes('Pago') && data.secciones?.includes('Carga'));
    check(
      'tiene las acciones mapa/chat/cerrar',
      (data.botones ?? []).some((b) => /Ver en el mapa/.test(b)) &&
        (data.botones ?? []).some((b) => /Chat con el repartidor/.test(b)) &&
        (data.botones ?? []).includes('Cerrar'),
    );

    {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT_DIR, 'order-detail-modal.png'), Buffer.from(shot.data, 'base64'));
      }
    }

    // Escape cierra el modal.
    await enviar('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await enviar('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await esperar(600);
    const cerrado = await evaluar(`!document.querySelector('div.fixed.inset-0.z-1000')`);
    check('Escape cierra el modal', cerrado);

    // El botón de ubicar en el mapa NO debe abrir el modal (stopPropagation).
    await evaluar(`(() => {
      const btn = [...document.querySelectorAll('table tbody tr button')].find((b) => /Ubicar/.test(b.getAttribute('title') || ''));
      if (btn) btn.click();
      return !!btn;
    })()`);
    await esperar(900);
    const sigueCerrado = await evaluar(`!document.querySelector('div.fixed.inset-0.z-1000')`);
    check('el botón "Ubicar en el mapa" no abre el modal', sigueCerrado);

    console.log(
      `\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`,
    );
    console.log(fallos === 0 ? '✅ modal de detalle ok' : `❌ ${fallos} verificación(es) con problemas`);
    ws.close();
    await esperar(300);
    process.exitCode = fallos === 0 && errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(USER_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
