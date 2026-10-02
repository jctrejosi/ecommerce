/**
 * Verifica el cambiador de temas del menú de usuario (delivery admin):
 *   1. el botón de usuario abre el menú con las opciones Claro/Oscuro/Sistema,
 *   2. elegir Oscuro aplica data-theme="dark" y guarda la preferencia,
 *   3. recargar mantiene el tema elegido,
 *   4. Sistema sigue la preferencia del SO (emulada aquí),
 *   5. capturas de las pestañas en claro y oscuro para revisión visual.
 *
 * Uso: node scripts-agent/check-theme-switcher.cjs [puerto]
 * Requiere: usuario QA temporal (create-qa-admin.cjs) y el panel corriendo.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9486;
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
      '--user-data-dir=/tmp/chrome-theme-probe',
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
    const captura = async (nombre) => {
      const shot = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shot?.data) {
        fs.writeFileSync(path.join(OUT, nombre), Buffer.from(shot.data, 'base64'));
      }
    };

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
    if (!(await esperarSelector('button[title="Cuenta y tema"]', 120))) {
      throw new Error(`no entró al panel: ${await evaluar('document.body.innerText.slice(0,150)')}`);
    }
    await esperar(2500);

    // Estado inicial: claro.
    const inicial = JSON.parse(
      await evaluar(`JSON.stringify({
        tema: document.documentElement.dataset.theme ?? null,
        guardado: localStorage.getItem('delivery_admin_theme'),
        fondo: getComputedStyle(document.body).backgroundColor,
      })`),
    );
    console.log(`[2] estado inicial: ${JSON.stringify(inicial)}`);
    await captura('tema-claro-mapa.png');

    // Abrir el menú de usuario.
    console.log('[3] abrir el menú de usuario');
    await evaluar(`document.querySelector('button[title="Cuenta y tema"]').click(); true`);
    await esperar(600);
    const menu = JSON.parse(
      await evaluar(`(() => {
        const textos = [...document.querySelectorAll('[role="menuitemradio"]')].map((b) =>
          b.textContent.trim());
        return JSON.stringify({ opciones: textos });
      })()`),
    );
    console.log(`[4] menú: ${JSON.stringify(menu)}`);
    await captura('tema-menu.png');

    // Elegir Oscuro.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('[role="menuitemradio"]')].find(
        (n) => n.textContent.trim() === 'Oscuro');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(800);
    const oscuro = JSON.parse(
      await evaluar(`JSON.stringify({
        tema: document.documentElement.dataset.theme ?? null,
        guardado: localStorage.getItem('delivery_admin_theme'),
        fondo: getComputedStyle(document.body).backgroundColor,
      })`),
    );
    console.log(`[5] tras elegir Oscuro: ${JSON.stringify(oscuro)}`);
    await captura('tema-oscuro-mapa.png');

    // Recargar: debe mantenerse oscuro.
    await enviar('Page.reload');
    await esperarSelector('button[title="Cuenta y tema"]', 120);
    await esperar(2500);
    const recargado = JSON.parse(
      await evaluar(`JSON.stringify({
        tema: document.documentElement.dataset.theme ?? null,
        guardado: localStorage.getItem('delivery_admin_theme'),
      })`),
    );
    console.log(`[6] tras recargar: ${JSON.stringify(recargado)}`);

    // Pestaña Repartidores en oscuro.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Repartidores');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(1800);
    await captura('tema-oscuro-repartidores.png');

    // Pestaña Pedidos en oscuro.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Pedidos');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(1800);
    await captura('tema-oscuro-pedidos.png');

    // Modal de edición de repartidor en oscuro.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Repartidores');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(1500);
    await evaluar(`document.querySelector('tbody tr')?.click(); true`);
    await esperar(1500);
    await captura('tema-oscuro-modal-editar.png');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (n) => n.innerText.trim() === 'Cancelar');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(800);

    // Chat del header en oscuro.
    await evaluar(`document.querySelector('button[title="Chat con repartidores"]')?.click(); true`);
    await esperar(1500);
    await captura('tema-oscuro-chat.png');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (n) => n.getAttribute('title') === 'Cerrar');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(600);

    // Sistema: con el SO en claro debe quedar claro; en oscuro, oscuro.
    await evaluar(`document.querySelector('button[title="Cuenta y tema"]').click(); true`);
    await esperar(500);
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('[role="menuitemradio"]')].find(
        (n) => n.textContent.trim() === 'Sistema');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(500);
    await enviar('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });
    await esperar(600);
    const sistemaDark = await evaluar(`document.documentElement.dataset.theme ?? null`);
    await enviar('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
    await esperar(600);
    const sistemaLight = await evaluar(`document.documentElement.dataset.theme ?? null`);
    console.log(`[7] sistema: dark→${sistemaDark} · light→${sistemaLight}`);

    // Volver a claro para dejar el panel como estaba.
    await evaluar(`document.querySelector('button[title="Cuenta y tema"]').click(); true`);
    await esperar(500);
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('[role="menuitemradio"]')].find(
        (n) => n.textContent.trim() === 'Claro');
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(500);
    const final = JSON.parse(
      await evaluar(`JSON.stringify({
        tema: document.documentElement.dataset.theme ?? null,
        guardado: localStorage.getItem('delivery_admin_theme'),
      })`),
    );
    console.log(`[8] de vuelta en claro: ${JSON.stringify(final)}`);

    // ── Assertions ──
    if (inicial.tema !== 'light') problemas.push(`el tema inicial debería ser claro (${inicial.tema})`);
    if (inicial.fondo !== 'rgb(241, 245, 249)') problemas.push(`fondo inicial inesperado: ${inicial.fondo}`);
    const opciones = (menu.opciones ?? []).join('|');
    if (!/Claro/.test(opciones) || !/Oscuro/.test(opciones) || !/Sistema/.test(opciones)) {
      problemas.push(`faltan opciones de tema: ${opciones}`);
    }
    if (oscuro.tema !== 'dark') problemas.push('elegir Oscuro no aplicó data-theme=dark');
    if (oscuro.guardado !== 'dark') problemas.push('la preferencia no se guardó en localStorage');
    if (oscuro.fondo !== 'rgb(11, 17, 32)') problemas.push(`fondo oscuro inesperado: ${oscuro.fondo}`);
    if (recargado.tema !== 'dark') problemas.push('al recargar no se mantuvo el tema oscuro');
    if (sistemaDark !== 'dark') problemas.push(`Sistema con SO oscuro dio ${sistemaDark}`);
    if (sistemaLight !== 'light') problemas.push(`Sistema con SO claro dio ${sistemaLight}`);
    if (final.tema !== 'light') problemas.push('no se pudo volver al tema claro');
    if (final.guardado !== 'light') problemas.push(`la preferencia final no quedó en light (${final.guardado})`);

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ cambiador de temas OK');
    process.exitCode = problemas.length || errores.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-theme-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
