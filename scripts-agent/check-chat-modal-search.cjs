/**
 * Verifica el buscador de la bandeja de chats del panel (modal del botón de
 * chat del header):
 *   1. sin filtro se ven todos los repartidores,
 *   2. filtra por nombre (case-insensitive),
 *   3. filtra por código/usuario (@juan),
 *   4. filtra por id del repartidor,
 *   5. sin coincidencias muestra el aviso,
 *   6. limpiar con la X restaura la lista completa,
 *   7. la lista tiene colchón inferior (pb-6) y degradado que difumina las
 *      filas contra el borde mientras scrollea (sin corte a ras),
 *   8. click en una fila abre el hilo y la flecha vuelve a la lista.
 *
 * Uso: node scripts-agent/check-chat-modal-search.cjs [puerto]
 * Requiere: usuario QA temporal (create-qa-admin.cjs) y el panel corriendo.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9483;
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
      '--user-data-dir=/tmp/chrome-chat-search-probe',
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

    const HELPERS = `
      window.__c = {
        input: () => document.querySelector('input[placeholder^="Buscar por nombre"]'),
        cont: () =>
          window.__c.input()
            .closest('div.rounded-2xl')
            .querySelector('div.overflow-y-auto'),
        filas: () => [...window.__c.cont().querySelectorAll(':scope > button')],
        textos: () => window.__c.filas().map((b) => b.innerText.replace(/\\s+/g, ' ').trim()),
        escribir: (el, v) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        limpiar: () => {
          const b = window.__c.input().parentElement.querySelector('button');
          b?.click();
          return Boolean(b);
        },
        medida: () => {
          const cont = window.__c.cont();
          const modal = window.__c.input().closest('div.rounded-2xl');
          const filas = window.__c.filas();
          const ultima = filas[filas.length - 1];
          return JSON.stringify({
            pb: getComputedStyle(cont).paddingBottom,
            huecoInferior: ultima
              ? Math.round(cont.getBoundingClientRect().bottom - ultima.getBoundingClientRect().bottom)
              : null,
            dentroDelModal: Math.round(modal.getBoundingClientRect().bottom - cont.getBoundingClientRect().bottom),
            hayScroll: cont.scrollHeight > cont.clientHeight,
          });
        },
        enHilo: () => Boolean(document.querySelector('button[title="Volver a la lista"]')),
        volver: () => {
          const b = document.querySelector('button[title="Volver a la lista"]');
          b?.click();
          return Boolean(b);
        },
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
    if (!(await esperarSelector('button[title="Chat con repartidores"]', 120))) {
      throw new Error(`no entró al panel: ${await evaluar('document.body.innerText.slice(0,150)')}`);
    }
    await esperar(2000);

    console.log('[2] abrir el modal de chat');
    await evaluar(`document.querySelector('button[title="Chat con repartidores"]').click(); true`);
    if (!(await esperarSelector('input[placeholder^="Buscar por nombre"]'))) {
      throw new Error('no apareció el buscador del modal de chat');
    }
    await esperar(1200);
    await evaluar(HELPERS);

    const total = JSON.parse(await evaluar(`JSON.stringify(window.__c.textos())`));
    console.log(`[3] sin filtro: ${total.length} filas`);
    const medida = JSON.parse(await evaluar(`window.__c.medida()`));
    console.log(`[4] medida de la lista: ${JSON.stringify(medida)}`);

    // ── Filtro por nombre (case-insensitive) ──
    await evaluar(`window.__c.escribir(window.__c.input(), 'DIEGO'); true`);
    await esperar(500);
    const porNombre = JSON.parse(await evaluar(`JSON.stringify(window.__c.textos())`));
    console.log(`[5] "DIEGO": ${JSON.stringify(porNombre)}`);

    // ── Filtro por código/usuario ──
    await evaluar(`window.__c.escribir(window.__c.input(), 'juan'); true`);
    await esperar(500);
    const porUsuario = JSON.parse(await evaluar(`JSON.stringify(window.__c.textos())`));
    console.log(`[6] "juan": ${JSON.stringify(porUsuario)}`);

    // ── Filtro por id ──
    await evaluar(`window.__c.escribir(window.__c.input(), '6'); true`);
    await esperar(500);
    const porId = JSON.parse(await evaluar(`JSON.stringify(window.__c.textos())`));
    console.log(`[7] "6": ${JSON.stringify(porId)}`);

    // ── Sin coincidencias ──
    await evaluar(`window.__c.escribir(window.__c.input(), 'zzzz'); true`);
    await esperar(500);
    const sinNada = JSON.parse(await evaluar(`JSON.stringify(window.__c.textos())`));
    const aviso = await evaluar(
      `window.__c.cont().innerText.includes('Ningún repartidor coincide')`,
    );
    console.log(`[8] "zzzz": filas=${sinNada.length} aviso=${aviso}`);

    // ── Limpiar con la X ──
    await evaluar(`window.__c.limpiar(); true`);
    await esperar(500);
    const restaurado = JSON.parse(await evaluar(`JSON.stringify(window.__c.textos())`));
    console.log(`[9] tras limpiar con la X: ${restaurado.length} filas`);

    // Captura de la bandeja filtrada por "juan" antes de entrar al hilo.
    await evaluar(`window.__c.escribir(window.__c.input(), 'juan'); true`);
    await esperar(500);
    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'chat-search.png'), Buffer.from(shot.data, 'base64'));
    }

    // ── Abrir el hilo y volver ──
    await evaluar(`window.__c.filas()[0].click(); true`);
    await esperar(1500);
    const enHilo = await evaluar(`window.__c.enHilo()`);
    const cabecera = await evaluar(`(() => {
      const ta = document.querySelector('textarea[placeholder^="Escribe a"]');
      if (!ta) return 'sin hilo';
      const modal = ta.closest('div.rounded-2xl');
      return modal.innerText.includes('@juan') ? 'con @juan' : 'sin @juan';
    })()`);
    console.log(`[10] hilo abierto: ${enHilo} · cabecera ${cabecera}`);
    await evaluar(`window.__c.volver(); true`);
    await esperar(800);
    const volvio = JSON.parse(await evaluar(`JSON.stringify(window.__c.textos())`));
    console.log(`[11] tras volver: ${volvio.length} filas (filtro "juan" conservado)`);

    // ── Fade inferior: las filas se difuminan contra el borde ──
    const fade = JSON.parse(await evaluar(`JSON.stringify((() => {
      const cont = window.__c.cont();
      const ov = cont.parentElement.querySelector(':scope > div[aria-hidden="true"]');
      const cs = ov ? getComputedStyle(ov) : null;
      return {
        hayOverlay: Boolean(ov),
        pointerEvents: cs ? cs.pointerEvents : null,
        gradiente: cs ? cs.backgroundImage.includes('linear-gradient') : false,
        alto: ov ? Math.round(ov.getBoundingClientRect().height) : 0,
      };
    })())`));
    console.log(`[12] fade inferior: ${JSON.stringify(fade)}`);

    // ── Scroll real: captura a mitad y hueco al final ──
    await evaluar(`window.__c.limpiar(); true`);
    await esperar(500);
    let hayScroll = JSON.parse(await evaluar(`(() => { const c = window.__c.cont(); return c.scrollHeight > c.clientHeight; })()`));
    if (!hayScroll) {
      // La ventana de prueba es alta: se encoge el modal para forzar el scroll.
      await evaluar(`(() => { window.__c.input().closest('div.rounded-2xl').style.height = '240px'; return true; })()`);
      await esperar(400);
      hayScroll = JSON.parse(await evaluar(`(() => { const c = window.__c.cont(); return c.scrollHeight > c.clientHeight; })()`));
    }
    const scrollMid = JSON.parse(await evaluar(`(() => { const c = window.__c.cont(); c.scrollTop = Math.floor((c.scrollHeight - c.clientHeight) / 2); return Math.round(c.scrollTop); })()`));
    const shotMid = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shotMid?.data) {
      fs.writeFileSync(path.join(OUT, 'chat-lista-scroll-mid.png'), Buffer.from(shotMid.data, 'base64'));
    }
    await evaluar(`(() => { const c = window.__c.cont(); c.scrollTop = c.scrollHeight; return true; })()`);
    await esperar(300);
    const huecoFinal = JSON.parse(await evaluar(`(() => {
      const cont = window.__c.cont();
      const filas = window.__c.filas();
      const u = filas[filas.length - 1];
      return Math.round(cont.getBoundingClientRect().bottom - u.getBoundingClientRect().bottom);
    })()`));
    const shotFinal = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shotFinal?.data) {
      fs.writeFileSync(path.join(OUT, 'chat-lista-scroll-final.png'), Buffer.from(shotFinal.data, 'base64'));
    }
    console.log(`[13] scroll: hay=${hayScroll} mid=${scrollMid}px huecoAlFinal=${huecoFinal}px`);

    // ── Assertions ──
    if (total.length < 2) problemas.push(`se esperaban varios repartidores, hay ${total.length}`);
    if (medida.pb !== '24px') problemas.push(`la lista no tiene pb-6: ${medida.pb}`);
    if (!medida.hayScroll && !(medida.huecoInferior >= 24)) {
      problemas.push(`la última fila toca el borde inferior (hueco ${medida.huecoInferior}px)`);
    }
    if (medida.dentroDelModal !== 0) problemas.push('la lista no llega al fondo del modal');
    if (porNombre.length !== 1 || !/diego/i.test(porNombre[0])) {
      problemas.push(`el filtro por nombre falló: ${JSON.stringify(porNombre)}`);
    }
    if (porUsuario.length !== 1 || !/@juan/.test(porUsuario[0])) {
      problemas.push(`el filtro por código falló: ${JSON.stringify(porUsuario)}`);
    }
    if (porId.length !== 1 || !/Juan/.test(porId[0])) {
      problemas.push(`el filtro por id falló: ${JSON.stringify(porId)}`);
    }
    if (sinNada.length !== 0 || !aviso) problemas.push('no se muestra el aviso sin coincidencias');
    if (restaurado.length !== total.length) {
      problemas.push(`limpiar no restauró todas las filas (${restaurado.length}/${total.length})`);
    }
    if (!enHilo) problemas.push('no se abrió el hilo al pulsar la fila');
    if (cabecera !== 'con @juan') problemas.push(`la cabecera del hilo no muestra @juan (${cabecera})`);
    if (!volvio.length || !volvio.every((t) => /juan/i.test(t))) {
      problemas.push(`volver a la lista perdió el filtro: ${JSON.stringify(volvio)}`);
    }
    if (!fade.hayOverlay || fade.pointerEvents !== 'none' || !fade.gradiente) {
      problemas.push(`falta el degradado inferior de la lista: ${JSON.stringify(fade)}`);
    }
    if (huecoFinal < 22) {
      problemas.push(`la última fila no conserva colchón inferior al final del scroll (${huecoFinal}px)`);
    }

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ buscador y estilos del modal de chat OK');
    process.exitCode = problemas.length || errores.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-chat-search-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
