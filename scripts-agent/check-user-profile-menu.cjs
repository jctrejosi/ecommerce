/**
 * Verifica el menú de cuenta del header (botón del admin) y el "Mi perfil":
 *   1. el menú trae "Mi perfil" y "Cerrar sesión" (ya no un botón suelto),
 *   2. "Mi perfil" abre el modal con sus pestañas y campos,
 *   3. guardar el perfil muestra "Perfil actualizado",
 *   4. cambiar la contraseña muestra "Contraseña actualizada".
 *
 * Uso: node scripts-agent/check-user-profile-menu.cjs [puerto]
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
const NUEVA = 'demo1234';
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
      '--user-data-dir=/tmp/chrome-user-menu-probe',
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
    const capturar = async (nombre) => {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT, nombre), Buffer.from(shot.data, 'base64'));
      }
    };

    const HELPERS = `
      window.__u = {
        modal: () =>
          [...document.querySelectorAll('div')].find(
            (d) => d.className.includes('max-w-lg') && d.className.includes('rounded-2xl')),
        porTexto: (tag, texto) =>
          [...document.querySelectorAll(tag)].find((b) => b.textContent.trim() === texto),
        porLabel: (texto) => {
          const l = [...document.querySelectorAll('label')].find((x) =>
            x.textContent.trim().toLowerCase().startsWith(texto));
          return l ? l.querySelector('input') : null;
        },
        set: (el, v) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        texto: (t) => document.body.innerText.includes(t),
      };
      true;
    `;

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');

    console.log(`[1] abriendo ${URL}`);
    await enviar('Page.navigate', { url: URL });
    if (!(await esperarSelector('input[autocomplete="username"]'))) {
      throw new Error('no apareció el login');
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
    if (!(await esperarSelector('button[title="Cuenta y tema"]', 120))) {
      throw new Error('no entró al panel');
    }
    await esperar(2000);
    await evaluar(HELPERS);

    console.log('[2] abrir el menú de cuenta');
    await evaluar(`document.querySelector('button[title="Cuenta y tema"]').click(); true`);
    await esperar(800);
    await capturar('menu-cuenta.png');

    const menu = JSON.parse(
      await evaluar(`JSON.stringify({
        hayPerfil: Boolean(window.__u.porTexto('button', 'Mi perfil')),
        haySalir: Boolean(window.__u.porTexto('button', 'Cerrar sesión')),
        logoutSuelto: document.querySelectorAll('button[title="Cerrar sesión"]').length,
        swatches: document.querySelectorAll('[role="menuitemradio"][aria-label]').length,
      })`),
    );
    console.log(`[3] menú: ${JSON.stringify(menu)}`);
    if (!menu.hayPerfil) problemas.push('el menú no tiene "Mi perfil"');
    if (!menu.haySalir) problemas.push('el menú no tiene "Cerrar sesión"');
    if (menu.logoutSuelto > 0) problemas.push('sigue el botón de cerrar sesión suelto en el header');
    if (menu.swatches < 9) problemas.push(`faltan swatches de tema/color (${menu.swatches})`);

    console.log('[4] abrir "Mi perfil"');
    await evaluar(`(() => { const b = window.__u.porTexto('button', 'Mi perfil'); b?.click(); return Boolean(b); })()`);
    if (!(await esperarSelector('div.max-w-lg'))) {
      problemas.push('no se abrió el modal de perfil');
    }
    await esperar(700);
    const modal = JSON.parse(
      await evaluar(`JSON.stringify((() => {
        const m = window.__u.modal();
        if (!m) return { hay: false };
        const labels = [...m.querySelectorAll('label span')].map((s) => s.textContent.trim().toLowerCase());
        return {
          hay: true,
          tabs: ['Mi perfil', 'Contraseña'].filter((t) => Boolean(window.__u.porTexto('button', t))),
          campos: ['nombre', 'apellido', 'email', 'teléfono', 'usuario'].filter((c) =>
            labels.some((l) => l.startsWith(c))),
          usuarioDisabled: window.__u.porLabel('usuario')?.disabled ?? null,
          botonFoto: Boolean(m.querySelector('button[title="Cambiar imagen de perfil"]')),
        };
      })())`),
    );
    console.log(`[5] modal: ${JSON.stringify(modal)}`);
    await capturar('perfil-modal.png');
    if (!modal.hay) problemas.push('el modal de perfil no se montó');
    else {
      if (modal.tabs.length !== 2) problemas.push(`faltan pestañas: ${modal.tabs}`);
      if (modal.campos.length < 5) problemas.push(`faltan campos: ${modal.campos}`);
      if (modal.usuarioDisabled !== true) problemas.push('el campo Usuario debería estar deshabilitado');
      if (!modal.botonFoto) problemas.push('no está el botón para cambiar la foto');
    }

    console.log('[6] guardar el perfil (teléfono)');
    await evaluar(`(() => {
      const el = window.__u.porLabel('teléfono');
      if (el) window.__u.set(el, '3009999999');
      return Boolean(el);
    })()`);
    await evaluar(`(() => { const b = window.__u.porTexto('button', 'Guardar'); b?.click(); return Boolean(b); })()`);
    let guardado = false;
    for (let i = 0; i < 16; i++) {
      guardado = await evaluar(`window.__u.texto('Perfil actualizado')`);
      if (guardado) break;
      await esperar(500);
    }
    console.log(`[7] perfil guardado: ${guardado}`);
    if (!guardado) problemas.push('no confirmó "Perfil actualizado" al guardar');

    console.log('[7b] cambiar la contraseña');
    await evaluar(`(() => { const b = window.__u.porTexto('button', 'Contraseña'); b?.click(); return Boolean(b); })()`);
    await esperar(600);
    const pwdOk = await evaluar(`(() => {
      const campos = [...(window.__u.modal()?.querySelectorAll('input[type="password"]') ?? [])];
      if (campos.length < 3) return false;
      window.__u.set(campos[0], ${JSON.stringify(CLAVE)});
      window.__u.set(campos[1], ${JSON.stringify(NUEVA)});
      window.__u.set(campos[2], ${JSON.stringify(NUEVA)});
      return true;
    })()`);
    if (!pwdOk) problemas.push('no aparecieron los 3 campos de contraseña');
    else {
      await evaluar(`(() => { const b = window.__u.porTexto('button', 'Cambiar contraseña'); b?.click(); return Boolean(b); })()`);
      let cambiada = false;
      for (let i = 0; i < 16; i++) {
        cambiada = await evaluar(`window.__u.texto('Contraseña actualizada')`);
        if (cambiada) break;
        await esperar(500);
      }
      console.log(`[8] contraseña actualizada: ${cambiada}`);
      if (!cambiada) problemas.push('no confirmó "Contraseña actualizada"');
    }
    await capturar('perfil-password.png');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ menú de cuenta y "Mi perfil" OK');
    process.exitCode = problemas.length || errores.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-user-menu-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
