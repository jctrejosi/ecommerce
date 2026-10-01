/**
 * Verifica la confirmación por contraseña del botón "Actualizar" de la sección
 * "Restablecer contraseña" (modal de edición de repartidor):
 *   1. con la contraseña vacía o corta el botón está deshabilitado,
 *   2. al pulsarlo con una contraseña válida NO se cambia nada: se abre un
 *      diálogo que pide repetirla,
 *   3. el botón de confirmar sigue deshabilitado hasta que coincida exactamente,
 *   4. si no coincide, muestra el aviso,
 *   5. cancelar cierra sin llamar a la API,
 *   6. confirmar llama a POST /delivery/admin/drivers/:id/reset-password,
 *      muestra el aviso de éxito y limpia el input,
 *   7. la contraseña nueva funciona de verdad en el login de la app móvil y,
 *      al terminar, se restaura la original (juan4231) y se verifica.
 *
 * Uso: node scripts-agent/check-reset-password-confirm.cjs [puerto]
 * Requiere: usuario QA temporal (create-qa-admin.cjs) y el panel corriendo.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.API_URL || 'http://localhost:3000';
const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9482;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
/** Contraseña de prueba que se le pone y luego se restaura. */
const NUEVA = 'Prueba123!';
const ORIGINAL = 'juan4231';
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

async function tokenQA() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USUARIO, password: CLAVE }),
  }).then((r) => r.json());
  return (login.data ?? login).accessToken;
}

/** Login real contra el endpoint que usa la app móvil de delivery. */
async function loginDelivery(username, password) {
  const res = await fetch(`${BASE}/delivery/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: Boolean((json?.data ?? json)?.accessToken) };
}

/** Devuelve el id del repartidor con ese usuario, vía API admin. */
async function idDelRepartidor(username) {
  const token = await tokenQA();
  const res = await fetch(`${BASE}/delivery/admin/drivers`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const lista = res.data ?? res;
  const d = (Array.isArray(lista) ? lista : []).find((x) => x.username === username);
  return d ? d.id : null;
}

async function restaurarPassword(id) {
  const token = await tokenQA();
  await fetch(`${BASE}/delivery/admin/drivers/${id}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: ORIGINAL }),
  });
  const check = await loginDelivery('juan', ORIGINAL);
  if (!check.ok) throw new Error('la restauración no permite el login con juan4231');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const driverId = await idDelRepartidor('juan');
  if (!driverId) throw new Error('no se encontró al repartidor juan en la API');
  console.log(`[0] repartidor juan → id ${driverId}`);

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
      '--user-data-dir=/tmp/chrome-reset-probe',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const problemas = [];
  const peticiones = [];
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
      if (msg.method === 'Network.requestWillBeSent') {
        peticiones.push({
          url: msg.params.request.url,
          method: msg.params.request.method,
        });
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

    const HELPERS = `
      window.__r = {
        inputNuevo: () => document.querySelector('input[placeholder^="Nueva contraseña"]'),
        btnActualizar: () => window.__r.inputNuevo().parentElement.querySelector('button'),
        dialogo: () => {
          const h3 = [...document.querySelectorAll('h3')].find((h) =>
            h.textContent.includes('Restablecer la contraseña'));
          return h3 ? h3.closest('div.rounded-2xl') : null;
        },
        inputConfirm: () => (window.__r.dialogo() ? window.__r.dialogo().querySelector('input') : null),
        btnConfirm: () => {
          const d = window.__r.dialogo();
          if (!d) return null;
          return [...d.querySelectorAll('button')].find((b) =>
            b.textContent.trim().toLowerCase() === 'actualizar contraseña');
        },
        btnCancelar: () => {
          const d = window.__r.dialogo();
          if (!d) return null;
          return [...d.querySelectorAll('button')].find((b) =>
            b.textContent.trim().toLowerCase() === 'cancelar');
        },
        aviso: () => {
          const d = window.__r.dialogo();
          if (!d) return null;
          const p = [...d.querySelectorAll('p')].find((n) => n.textContent.includes('no coinciden'));
          return p ? p.textContent.trim() : null;
        },
        notice: () => document.body.innerText.includes('Contraseña actualizada'),
        escribir: (el, v) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        estado: () => JSON.stringify({
          nuevo: window.__r.inputNuevo().value,
          actualizarDeshabilitado: window.__r.btnActualizar().disabled,
          dialogo: Boolean(window.__r.dialogo()),
          confirmDeshabilitado: window.__r.dialogo() ? window.__r.btnConfirm().disabled : null,
          aviso: window.__r.aviso(),
          notice: window.__r.notice(),
        }),
      };
      true;
    `;

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Network.enable');

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

    console.log('[2] Repartidores → abrir la ficha de juan');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Repartidores');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(2500);
    const abrioFila = await evaluar(`(() => {
      const tr = [...document.querySelectorAll('tbody tr')].find((t) =>
        t.innerText.split(/\\s+/).includes('@juan'));
      tr?.click();
      return Boolean(tr);
    })()`);
    await esperar(2000);
    if (!abrioFila) problemas.push('no se encontró la fila de @juan');
    const modal = await evaluar(
      `document.body.innerText.includes('Editar repartidor') ? 'ok' : 'falta'`,
    );
    console.log(`[3] modal de edición: ${modal}`);
    if (modal !== 'ok') problemas.push('no se abrió el modal de edición');

    // ── 1. Sin contraseña / contraseña corta: botón deshabilitado ──
    const e0 = JSON.parse(await evaluar(`window.__r.estado()`));
    console.log(`[4] input vacío: ${JSON.stringify(e0)}`);
    const peticionesAntes = peticiones.filter(
      (p) => p.url.includes('reset-password') && p.method === 'POST',
    ).length;
    await evaluar(`window.__r.btnActualizar().click(); true`);
    await esperar(600);
    const trasClickCorto = JSON.parse(await evaluar(`window.__r.estado()`));
    await evaluar(`window.__r.escribir(window.__r.inputNuevo(), 'corta'); true`);
    await esperar(400);
    const e1 = JSON.parse(await evaluar(`window.__r.estado()`));
    console.log(`[5] con "corta": ${JSON.stringify(e1)}`);

    // ── 2. Contraseña válida → debe abrir diálogo (no llamar a la API) ──
    await evaluar(`window.__r.escribir(window.__r.inputNuevo(), ${JSON.stringify(NUEVA)}); true`);
    await esperar(400);
    const e2 = JSON.parse(await evaluar(`window.__r.estado()`));
    await evaluar(`window.__r.btnActualizar().click(); true`);
    await esperar(800);
    const d1 = JSON.parse(await evaluar(`window.__r.estado()`));
    console.log(`[6] tras pulsar Actualizar: ${JSON.stringify(d1)}`);

    // ── 3. Distinta → deshabilitado + aviso ──
    await evaluar(
      `window.__r.escribir(window.__r.inputConfirm(), ${JSON.stringify('OtraClave123')}); true`,
    );
    await esperar(400);
    const d2 = JSON.parse(await evaluar(`window.__r.estado()`));
    console.log(`[7] contraseña distinta: ${JSON.stringify(d2)}`);

    // ── 4. La misma → habilitado ──
    await evaluar(
      `window.__r.escribir(window.__r.inputConfirm(), ${JSON.stringify(NUEVA)}); true`,
    );
    await esperar(400);
    const d3 = JSON.parse(await evaluar(`window.__r.estado()`));
    console.log(`[8] contraseña repetida: ${JSON.stringify(d3)}`);

    // Captura con el diálogo abierto y todo listo para confirmar.
    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'reset-confirm-dialogo.png'), Buffer.from(shot.data, 'base64'));
    }

    // ── 5. Cancelar → cierra sin llamar a la API ──
    await evaluar(`window.__r.btnCancelar().click(); true`);
    await esperar(600);
    const c1 = JSON.parse(await evaluar(`window.__r.estado()`));
    const peticionesTrasCancelar = peticiones.filter(
      (p) => p.url.includes('reset-password') && p.method === 'POST',
    ).length;
    console.log(`[9] tras cancelar: ${JSON.stringify(c1)} · peticiones=${peticionesTrasCancelar}`);

    // ── 6. Reabrir y confirmar → llama a la API y limpia ──
    await evaluar(`window.__r.btnActualizar().click(); true`);
    await esperar(700);
    await evaluar(
      `window.__r.escribir(window.__r.inputConfirm(), ${JSON.stringify(NUEVA)}); true`,
    );
    await esperar(400);
    await evaluar(`window.__r.btnConfirm().click(); true`);
    let trasConfirmar = null;
    for (let i = 0; i < 20; i++) {
      await esperar(400);
      trasConfirmar = JSON.parse(await evaluar(`window.__r.estado()`));
      if (trasConfirmar.notice) break;
    }
    const peticionesReset = peticiones.filter(
      (p) => p.url.includes('reset-password') && p.method === 'POST',
    );
    console.log(`[10] tras confirmar: ${JSON.stringify(trasConfirmar)}`);
    console.log(`[10] peticiones reset-password: ${peticionesReset.length}`);

    // ── 7. La contraseña nueva debe servir en el login real de la app ──
    const loginNuevo = await loginDelivery('juan', NUEVA);
    console.log(`[11] login con la contraseña nueva → ${JSON.stringify(loginNuevo)}`);

    // Cerrar el modal sin guardar (no debe tocar otros campos).
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find((n) => n.innerText.trim() === 'Cancelar');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(1200);

    // ── Assertions ──
    if (e0.actualizarDeshabilitado !== true) problemas.push('con el input vacío el botón no está deshabilitado');
    if (trasClickCorto.dialogo) problemas.push('pulsar Actualizar con la contraseña vacía abrió el diálogo');
    if (e1.actualizarDeshabilitado !== true) problemas.push('con contraseña corta el botón no está deshabilitado');
    if (e2.actualizarDeshabilitado !== false) problemas.push('con contraseña válida el botón sigue deshabilitado');
    if (!d1.dialogo) problemas.push('no se abrió el diálogo de confirmación');
    if (d1.confirmDeshabilitado !== true) problemas.push('el botón de confirmar estaba habilitado sin repetir la contraseña');
    if (d2.confirmDeshabilitado !== true) problemas.push('una contraseña distinta habilitó la confirmación');
    if (!d2.aviso) problemas.push('no se muestra el aviso de que las contraseñas no coinciden');
    if (d3.confirmDeshabilitado !== false) problemas.push('repetir la misma contraseña no habilitó la confirmación');
    if (c1.dialogo) problemas.push('el diálogo no se cerró al cancelar');
    if (peticionesTrasCancelar > peticionesAntes) problemas.push('cancelar llamó a la API de reset-password');
    if (!trasConfirmar.notice) problemas.push('no apareció el aviso de contraseña actualizada');
    if (trasConfirmar.nuevo !== '') problemas.push('el input de la nueva contraseña no se limpió');
    if (trasConfirmar.dialogo) problemas.push('el diálogo no se cerró al confirmar');
    if (peticionesReset.length !== 1) problemas.push(`se esperaba 1 llamada a reset-password, hubo ${peticionesReset.length}`);
    if (!loginNuevo.ok) problemas.push('la contraseña nueva no sirve en el login de la app móvil');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ confirmación de restablecer contraseña funcionando');
    process.exitCode = problemas.length || errores.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-reset-probe', { recursive: true, force: true });
    // Restaura siempre (es idempotente) para no dejar a juan sin su contraseña.
    try {
      await restaurarPassword(driverId);
      console.log(`[12] contraseña de juan restaurada y verificada (${ORIGINAL})`);
    } catch (err) {
      console.error(`[12] ¡NO se pudo restaurar la contraseña de juan!: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
