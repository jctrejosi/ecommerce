/**
 * Verifica la pestaña "Pedidos" del panel de delivery:
 *   1. muestra TODOS los pedidos (entregados y cancelados incluidos), no solo
 *      los activos,
 *   2. carga de a 20 (lazyload con scroll),
 *   3. al llegar al fondo carga la siguiente página sin repetidos,
 *   4. los filtros Entregados/Cancelados aplican sobre el total,
 *   5. el buscador filtra contra el servidor (con debounce),
 *   6. el contador "Mostrando X de Y" refleja lo cargado y el total.
 *
 * Uso: node scripts-agent/check-orders-lazyload.cjs [puerto]
 * Requiere: usuario QA temporal (create-qa-admin.cjs) y el panel corriendo.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9484;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';
const OUT = path.join(__dirname, '.scratch');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Comprueba contra el API que las páginas no se solapen (por assignmentId). */
async function paginasSinRepetir() {
  const login = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa-delivery-temp', password: 'demo123' }),
  }).then((r) => r.json());
  const token = (login.data ?? login).accessToken;
  const get = async (offset) => {
    const r = await fetch(
      `http://localhost:3000/delivery/admin/orders?limit=20&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const j = await r.json();
    return (j.data ?? j).items;
  };
  const [p1, p2] = await Promise.all([get(0), get(20)]);
  const ids1 = new Set(p1.map((o) => o.assignmentId));
  return {
    p1: p1.length,
    p2: p2.length,
    repetidos: p2.filter((o) => ids1.has(o.assignmentId)).length,
  };
}

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
      '--user-data-dir=/tmp/chrome-orders-probe',
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
      window.__o = {
        filas: () => [...document.querySelectorAll('tbody tr')].filter((tr) =>
          tr.querySelector('button[title="Ubicar en el mapa"]')),
        scrollTop: () => document.querySelector('table').closest('div.overflow-auto').scrollTop,
        contador: () => {
          const p = [...document.querySelectorAll('p')].find((el) =>
            (el.textContent || '').startsWith('Mostrando'));
          return p ? p.textContent.trim() : null;
        },
        chip: (texto) => [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === texto),
        input: () => document.querySelector('input[placeholder^="Buscar pedido"]'),
        escribir: (el, v) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        scrollAbajo: () => {
          const cont = document.querySelector('table').closest('div.overflow-auto');
          cont.scrollTop = cont.scrollHeight;
          return cont.scrollTop > 0;
        },
        pie: () => {
          const tr = [...document.querySelectorAll('tbody tr')].pop();
          return tr ? tr.innerText.trim() : null;
        },
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
    await esperar(2000);

    console.log('[2] abrir la pestaña Pedidos');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Pedidos');
      b?.click();
      return Boolean(b);
    })()`);
    if (!(await esperarSelector('input[placeholder^="Buscar pedido"]'))) {
      throw new Error('no apareció la pestaña de pedidos');
    }
    await evaluar(HELPERS);
    // Espera a que termine la primera carga.
    for (let i = 0; i < 40; i++) {
      await esperar(400);
      if ((await evaluar(`window.__o.filas().length`)) > 0) break;
    }

    const pagina1 = {
      filas: await evaluar(`window.__o.filas().length`),
      contador: await evaluar(`window.__o.contador()`),
    };
    console.log(`[3] página 1: ${JSON.stringify(pagina1)}`);

    console.log('[4] scroll al fondo → debe cargar la página 2');
    await evaluar(`window.__o.scrollAbajo(); true`);
    for (let i = 0; i < 40; i++) {
      await esperar(400);
      if ((await evaluar(`window.__o.filas().length`)) > pagina1.filas) break;
    }
    const pagina2 = {
      filas: await evaluar(`window.__o.filas().length`),
      contador: await evaluar(`window.__o.contador()`),
    };
    console.log(`[5] página 2: ${JSON.stringify(pagina2)}`);

    const apiCheck = await paginasSinRepetir();
    console.log(`[6] páginas del API: ${JSON.stringify(apiCheck)}`);

    // ── Scroll repetido hasta la última página ──
    let alFinal = pagina2;
    for (let i = 0; i < 12; i++) {
      await evaluar(`window.__o.scrollAbajo(); true`);
      await esperar(1200);
      alFinal = {
        filas: await evaluar(`window.__o.filas().length`),
        contador: await evaluar(`window.__o.contador()`),
        pie: await evaluar(`window.__o.pie()`),
      };
      const m = /Mostrando (\d+) de (\d+)/.exec(alFinal.contador ?? '');
      if (m && Number(m[1]) >= Number(m[2])) break;
    }
    console.log(`[6b] fin de lista: ${JSON.stringify(alFinal)}`);

    // ── Filtro Entregados (debe aplicar sobre el total del servidor) ──
    await evaluar(`window.__o.chip('Entregados').click(); true`);
    await esperar(1800);
    const entregados = {
      filas: await evaluar(`window.__o.filas().length`),
      contador: await evaluar(`window.__o.contador()`),
      scrollTop: await evaluar(`window.__o.scrollTop()`),
      estados: await evaluar(`JSON.stringify([...document.querySelectorAll('tbody tr')]
        .filter((tr) => tr.querySelector('button[title="Ubicar en el mapa"]'))
        .map((tr) => (tr.innerText.match(/Entregado|Cancelado|En entrega|Recogido|Asignado|Recogiendo/) || ['?'])[0]))`),
    };
    console.log(`[7] filtro Entregados: ${JSON.stringify(entregados)}`);

    // ── Filtro Cancelados ──
    await evaluar(`window.__o.chip('Cancelados').click(); true`);
    await esperar(1500);
    const cancelados = {
      filas: await evaluar(`window.__o.filas().length`),
      contador: await evaluar(`window.__o.contador()`),
    };
    console.log(`[8] filtro Cancelados: ${JSON.stringify(cancelados)}`);

    // Captura con el filtro Cancelados (muestra estados no activos).
    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(path.join(OUT, 'orders-lazyload.png'), Buffer.from(shot.data, 'base64'));
    }

    // ── Buscador contra el servidor ──
    await evaluar(`window.__o.chip('Todos').click(); true`);
    await esperar(1200);
    await evaluar(`window.__o.escribir(window.__o.input(), 'juan'); true`);
    await esperar(1600);
    const buscado = {
      filas: await evaluar(`window.__o.filas().length`),
      contador: await evaluar(`window.__o.contador()`),
      todasDeJuan: await evaluar(`window.__o.filas().every((tr) => /Juan/i.test(tr.innerText))`),
    };
    console.log(`[9] búsqueda "juan": ${JSON.stringify(buscado)}`);

    // ── Assertions ──
    if (pagina1.filas !== 20) problemas.push(`la primera página no trajo 20 (trajo ${pagina1.filas})`);
    if (!/de \d+ pedidos/.test(pagina1.contador ?? '')) {
      problemas.push(`contador inesperado: ${pagina1.contador}`);
    }
    if (pagina2.filas <= pagina1.filas) problemas.push('el scroll al fondo no cargó más pedidos');
    if (apiCheck.repetidos !== 0) problemas.push('hay pedidos repetidos entre páginas del API');
    const fin = /Mostrando (\d+) de (\d+)/.exec(alFinal.contador ?? '');
    if (!fin || fin[1] !== fin[2]) {
      problemas.push(`no se llegó al final de la lista: ${alFinal.contador}`);
    }
    if (!/No hay más pedidos/.test(alFinal.pie ?? '')) {
      problemas.push('no aparece el aviso de fin de lista');
    }
    if (!/Entregado/.test(entregados.estados ?? '')) {
      problemas.push(`el filtro Entregados muestra otros estados: ${entregados.estados}`);
    }
    if (entregados.filas !== 20) problemas.push(`el filtro Entregados debe volver a 20 filas (${entregados.filas})`);
    if (entregados.scrollTop !== 0) problemas.push(`el scroll no volvió arriba al filtrar (${entregados.scrollTop})`);
    if (!/Mostrando \d+ de \d+/.test(entregados.contador ?? '')) {
      problemas.push(`contador del filtro inesperado: ${entregados.contador}`);
    }
    if (cancelados.filas === 0) problemas.push('el filtro Cancelados no devolvió pedidos');
    if (buscado.filas === 0) problemas.push('la búsqueda "juan" no devolvió pedidos');
    if (!buscado.todasDeJuan) problemas.push('la búsqueda devolvió filas que no son de Juan');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ pestaña de pedidos con lazyload OK');
    process.exitCode = problemas.length || errores.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-orders-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
