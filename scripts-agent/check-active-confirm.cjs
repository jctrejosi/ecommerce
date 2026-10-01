/**
 * Verifica la confirmación por texto del check "Cuenta activa" (modal de
 * edición de repartidor):
 *   1. al marcarlo/desmarcarlo NO cambia solo: abre un diálogo,
 *   2. pide escribir "desactivar" o "activar" según el caso,
 *   3. el botón de confirmar está deshabilitado hasta que la palabra sea exacta,
 *   4. la trampa: al pedir "activar", escribir "desactivar" NO debe valer
 *      (porque "desactivar" contiene "activar"),
 *   5. cancelar deja el check como estaba,
 *   6. el cambio solo se aplica al confirmar (y NO se guarda en la BD: se cierra
 *      el modal sin guardar).
 *
 * Uso: node scripts-agent/check-active-confirm.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.API_URL || 'http://localhost:3000';
const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9481;
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

/** Estado del repartidor según la API (para comprobar que no se guardó nada). */
async function estadoEnApi(id) {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USUARIO, password: CLAVE }),
  }).then((r) => r.json());
  const token = (login.data ?? login).accessToken;
  const res = await fetch(`${BASE}/delivery/admin/drivers/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const d = res.data ?? res;
  return { isActive: d.isActive, isAvailable: d.isAvailable };
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
      '--user-data-dir=/tmp/chrome-confirm-probe',
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

    // Helpers que se inyectan en la página.
    const HELPERS = `
      window.__t = {
        label: (texto) => [...document.querySelectorAll('label')].find((l) =>
          l.textContent.trim().toLowerCase().startsWith(texto.toLowerCase())),
        check: () => window.__t.label('Cuenta activa').querySelector('input[type=checkbox]'),
        dialogo: () => {
          const lab = [...document.querySelectorAll('label')].find((l) =>
            l.textContent.includes('para confirmar'));
          return lab ? lab.closest('div.rounded-2xl') : null;
        },
        escribir: (el, v) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        btnConfirmar: () => {
          const d = window.__t.dialogo();
          if (!d) return null;
          return [...d.querySelectorAll('button')].find((b) => /^(activar|desactivar)$/i.test(b.innerText.trim()));
        },
        btnCancelar: () => {
          const d = window.__t.dialogo();
          if (!d) return null;
          return [...d.querySelectorAll('button')].find((b) => /^cancelar$/i.test(b.innerText.trim()));
        },
        estado: () => JSON.stringify({
          check: window.__t.check().checked,
          dialogo: Boolean(window.__t.dialogo()),
          instruccion: window.__t.dialogo()
            ? window.__t.dialogo().querySelector('label').innerText.replace(/\\s+/g, ' ').trim()
            : null,
          boton: window.__t.btnConfirmar()?.innerText.trim() ?? null,
          botonDeshabilitado: window.__t.btnConfirmar()?.disabled ?? null,
        }),
      };
      true;
    `;

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
    if (!(await esperarSelector('header nav button', 120))) {
      throw new Error(`no entró al panel: ${await evaluar('document.body.innerText.slice(0,150)')}`);
    }
    await esperar(2500);
    await evaluar(HELPERS);

    console.log('[2] Repartidores → abrir el modal de edición');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Repartidores');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(2500);
    await evaluar(`(() => {
      const tr = document.querySelector('tbody tr');
      tr?.click();
      return Boolean(tr);
    })()`);
    await esperar(2000);

    const abierto = await evaluar(
      `document.body.innerText.includes('Editar repartidor') ? 'ok' : 'falta'`,
    );
    console.log(`[3] modal de edición: ${abierto}`);

    const inicial = await evaluar(`window.__t.estado()`);
    console.log(`[4] estado inicial: ${inicial}`);
    const i0 = JSON.parse(inicial);

    // ── Desactivar: debe pedir "desactivar" ──
    await evaluar(`window.__t.check().click(); true`);
    await esperar(800);
    const d1 = JSON.parse(await evaluar(`window.__t.estado()`));
    console.log(`[5] al desmarcar: ${JSON.stringify(d1)}`);

    // Trampa: "activar" no debe servir para desactivar.
    await evaluar(`window.__t.escribir(window.__t.dialogo().querySelector('input'), 'activar'); true`);
    await esperar(400);
    const trap1 = JSON.parse(await evaluar(`window.__t.estado()`));
    console.log(`[6] escribiendo "activar" (no debe habilitar): deshabilitado=${trap1.botonDeshabilitado}`);

    // Palabra correcta.
    await evaluar(`window.__t.escribir(window.__t.dialogo().querySelector('input'), 'desactivar'); true`);
    await esperar(400);
    const ok1 = JSON.parse(await evaluar(`window.__t.estado()`));
    console.log(`[7] escribiendo "desactivar": deshabilitado=${ok1.botonDeshabilitado}`);

    await evaluar(`window.__t.btnConfirmar().click(); true`);
    await esperar(800);
    const tras1 = JSON.parse(await evaluar(`window.__t.estado()`));
    console.log(`[8] tras confirmar: ${JSON.stringify(tras1)}`);

    // ── Activar: debe pedir "activar" ──
    await evaluar(`window.__t.check().click(); true`);
    await esperar(800);
    const d2 = JSON.parse(await evaluar(`window.__t.estado()`));
    console.log(`[9] al volver a marcar: ${JSON.stringify(d2)}`);

    await evaluar(`window.__t.escribir(window.__t.dialogo().querySelector('input'), 'desactivar'); true`);
    await esperar(400);
    const trap2 = JSON.parse(await evaluar(`window.__t.estado()`));
    console.log(`[10] escribiendo "desactivar" (no debe habilitar): deshabilitado=${trap2.botonDeshabilitado}`);

    // Cancelar: no debe cambiar nada.
    await evaluar(`window.__t.btnCancelar().click(); true`);
    await esperar(600);
    const cancelado = JSON.parse(await evaluar(`window.__t.estado()`));
    console.log(`[11] tras cancelar: ${JSON.stringify(cancelado)}`);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'active-confirm.png'), Buffer.from(shot.data, 'base64'));
    }
    // Captura del diálogo abierto (para revisarlo a ojo).
    await evaluar(`window.__t.check().click(); true`);
    await esperar(800);
    await evaluar(`window.__t.escribir(window.__t.dialogo().querySelector('input'), 'desactivar'); true`);
    await esperar(400);
    const shot2 = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot2?.data) {
      fs.writeFileSync(path.join(OUT, 'active-confirm-dialogo.png'), Buffer.from(shot2.data, 'base64'));
    }
    await evaluar(`window.__t.btnCancelar()?.click(); true`);
    await esperar(500);

    // Cerrar sin guardar para no tocar la BD.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find((n) => n.innerText.trim() === 'Cancelar');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(1200);

    const problemas = [];
    if (abierto !== 'ok') problemas.push('no se abrió el modal de edición');
    if (!i0.check) problemas.push('el repartidor de prueba debería estar activo de entrada');
    if (d1.check !== true) problemas.push('al hacer clic el check cambió solo (debe esperar confirmación)');
    if (!d1.dialogo) problemas.push('no apareció el diálogo al desmarcar');
    if (!/desactivar/i.test(d1.instruccion ?? '')) problemas.push(`la instrucción no pide "desactivar": ${d1.instruccion}`);
    if (d1.botonDeshabilitado !== true) problemas.push('el botón estaba habilitado sin escribir nada');
    if (trap1.botonDeshabilitado !== true) problemas.push('"activar" habilitó la confirmación al desactivar');
    if (ok1.botonDeshabilitado !== false) problemas.push('"desactivar" no habilitó la confirmación');
    if (tras1.dialogo) problemas.push('el diálogo no se cerró al confirmar');
    if (tras1.check !== false) problemas.push('el check no quedó desmarcado tras confirmar');
    if (!/activar/i.test(d2.instruccion ?? '') || /desactivar/i.test(d2.instruccion ?? '')) {
      problemas.push(`al activar la instrucción debe pedir "activar": ${d2.instruccion}`);
    }
    if (trap2.botonDeshabilitado !== true) problemas.push('"desactivar" habilitó la confirmación al activar');
    if (cancelado.check !== false) problemas.push('cancelar cambió el check');
    if (cancelado.dialogo) problemas.push('el diálogo no se cerró al cancelar');

    // La BD no debe haberse tocado (se cerró sin guardar).
    const api = await estadoEnApi(6);
    console.log(`[12] API del repartidor 6 (sin guardar): ${JSON.stringify(api)}`);
    if (api.isActive === false) problemas.push('¡se guardó el cambio en la BD sin querer!');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ confirmación por texto funcionando');
    ws.close();
    process.exitCode = problemas.length || errores.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-confirm-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
