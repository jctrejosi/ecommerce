/**
 * Verifica la tarjeta "Pedido activo" en el detalle (modal) del repartidor:
 *   1. al abrir el detalle de un repartidor con pedido activo, la tarjeta
 *      aparece arriba, antes del formulario y sin necesidad de scrollear,
 *   2. el badge de estado coincide con el de la tabla,
 *   3. el borde y el fondo usan el color del estado (STATUS_META),
 *   4. el punto del estado tiene la animación `ping`,
 *   5. muestra código de pedido y dirección,
 *   6. en un repartidor sin pedido activo la tarjeta NO aparece.
 *
 * Uso: node scripts-agent/check-driver-active-order-banner.cjs [puerto]
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

/** Copiado de `lib/status.ts` (label → color). */
const ACTIVOS = {
  Asignado: '#0ea5e9',
  Aceptado: '#f59e0b',
  Recogiendo: '#f97316',
  'Pedido recogido': '#8b5cf6',
  'En entrega': '#16a34a',
};
const SIN_PEDIDO = ['Desactivado', 'Desconectado', 'Disponible', 'No disponible'];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const normalizar = (c) => (c || '').replace(/\s+/g, '');

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
      '--window-size=1400,1000',
      '--user-data-dir=/tmp/chrome-driver-order-probe',
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
      window.__d = {
        modal: () => {
          const h = [...document.querySelectorAll('h2')].find((x) =>
            x.textContent.includes('Editar repartidor'),
          );
          return h ? h.closest('div.rounded-2xl') : null;
        },
        banner: () => {
          const m = window.__d.modal();
          if (!m) return null;
          const p = [...m.querySelectorAll('p')].find(
            (x) => x.textContent.trim().toLowerCase() === 'pedido activo',
          );
          return p ? p.nextElementSibling : null;
        },
        badge: () => {
          const b = window.__d.banner();
          if (!b) return null;
          const cand = [...b.querySelectorAll('span')].find(
            (s) =>
              s.textContent.trim() &&
              !s.classList.contains('animate-ping') &&
              s.className.includes('px-2'),
          );
          return cand ? cand.textContent.trim() : null;
        },
        filas: () => [...document.querySelectorAll('tbody tr')],
        estadoDeFila: (tr) => {
          const labels = ['Asignado','Aceptado','Recogiendo','Pedido recogido','En entrega','Desactivado','Desconectado','Disponible','No disponible','Entregado'];
          const s = [...tr.querySelectorAll('span')].find((x) => labels.includes(x.textContent.trim()));
          return s ? s.textContent.trim() : null;
        },
        filaJson: () =>
          JSON.stringify(
            window.__d.filas().map((tr, i) => ({
              i,
              nombre: (tr.querySelector('td p') ? tr.querySelector('td p').textContent : '').trim(),
              estado: window.__d.estadoDeFila(tr),
            })),
          ),
        abrirFila: (i) => {
          const tr = window.__d.filas()[i];
          if (!tr) return false;
          tr.click();
          return true;
        },
        abrirEnMapa: (i) => {
          const tr = window.__d.filas()[i];
          if (!tr) return false;
          const b = [...tr.querySelectorAll('button')].find((x) => x.title === 'Ver en el mapa');
          if (!b) return false;
          b.click();
          return true;
        },
        cerrarModal: () => {
          const m = window.__d.modal();
          const svg = m ? m.querySelector('svg.lucide-x') : null;
          const b = svg ? svg.closest('button') : null;
          if (b) b.click();
          return Boolean(b);
        },
        detalle: () =>
          JSON.stringify((() => {
            const m = window.__d.modal();
            const b = window.__d.banner();
            if (!m) return { hayModal: false };
            if (!b) return { hayModal: true, hayTarjeta: false };
            const cs = getComputedStyle(b);
            const ping = b.querySelector('.animate-ping');
            const form = m.querySelector('form');
            const rect = b.getBoundingClientRect();
            const mrect = m.getBoundingClientRect();
            return {
              hayModal: true,
              hayTarjeta: true,
              badge: window.__d.badge(),
              borde: cs.borderColor,
              fondo: cs.backgroundColor,
              animacion: ping ? getComputedStyle(ping).animationName : null,
              visible: rect.top >= mrect.top && rect.bottom <= mrect.bottom,
              antesDelForm: form ? rect.bottom <= form.getBoundingClientRect().top : null,
              scrollArriba: m.scrollTop === 0,
              codigo: (b.querySelector('span.font-bold') ? b.querySelector('span.font-bold').textContent : '').trim(),
            };
          })()),
        fichaJson: () =>
          JSON.stringify((() => {
            const h4s = [...document.querySelectorAll('h4')];
            const pedido = h4s.find((h) => h.textContent.trim().toLowerCase() === 'pedido activo');
            const fichaAbierta = [...document.querySelectorAll('button')].some((x) =>
              x.textContent.includes('Volver a la flota'),
            );
            if (!pedido) return { hayPedido: false, fichaAbierta };
            const seccion = pedido.closest('section');
            const estadoEl = [...document.querySelectorAll('h4, span')].find(
              (h) => h.textContent.trim().toLowerCase() === 'estado actual',
            );
            const estado = estadoEl ? estadoEl.closest('section') : null;
            const ping = seccion.querySelector('.animate-ping');
            const card = ping ? ping.closest('div.rounded-xl') : null;
            return {
              hayPedido: true,
              fichaAbierta,
              ocurrencias: h4s.filter((h) => h.textContent.trim().toLowerCase() === 'pedido activo').length,
              animacion: ping ? getComputedStyle(ping).animationName : null,
              codigo: card && card.querySelector('span.font-bold')
                ? card.querySelector('span.font-bold').textContent.trim()
                : '',
              arribaDeEstado: estado
                ? seccion.getBoundingClientRect().top < estado.getBoundingClientRect().top
                : null,
            };
          })()),
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
    await evaluar(HELPERS);

    console.log('[2] abrir el tab Repartidores');
    const abrioTab = await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.textContent.trim() === 'Repartidores',
      );
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!abrioTab || !(await esperarSelector('tbody tr'))) {
      throw new Error('no se abrió la tabla de repartidores');
    }
    await esperar(800);

    const filas = JSON.parse(await evaluar('window.__d.filaJson()'));
    console.log(`[3] ${filas.length} filas: ${filas.map((f) => `${f.nombre}(${f.estado})`).join(' · ')}`);

    const conPedido = filas.find((f) => f.estado && ACTIVOS[f.estado]);
    const sinPedido = filas.find((f) => f.estado && SIN_PEDIDO.includes(f.estado));

    // ── Repartidor con pedido activo ──
    if (!conPedido) {
      problemas.push('ningún repartidor de la tabla tiene pedido activo para probar');
    } else {
      console.log(`[4] abriendo detalle de ${conPedido.nombre} (${conPedido.estado})`);
      if (!(await evaluar(`window.__d.abrirFila(${conPedido.i})`))) {
        problemas.push('no se pudo clickear la fila');
      }
      if (!(await esperarSelector('h2'))) {
        problemas.push('no se abrió el detalle del repartidor');
      }
      await esperar(800);
      const det = JSON.parse(await evaluar('window.__d.detalle()'));
      console.log(`[5] tarjeta: ${JSON.stringify(det)}`);
      await capturar('driver-modal-pedido-activo.png');

      if (!det.hayModal) problemas.push('no se abrió el modal de detalle');
      if (!det.hayTarjeta) {
        problemas.push('no aparece la tarjeta de pedido activo');
      } else {
        if (det.badge !== conPedido.estado) {
          problemas.push(`el badge (${det.badge}) no coincide con la tabla (${conPedido.estado})`);
        }
        const esperado = ACTIVOS[conPedido.estado];
        if (esperado && normalizar(det.borde) !== normalizar(hexToRgb(esperado))) {
          problemas.push(`el borde (${det.borde}) no usa el color del estado (${esperado})`);
        }
        if (/rgba?\(0, ?0, ?0, ?0\)/.test(det.fondo || '')) {
          problemas.push('el fondo de la tarjeta es transparente');
        }
        if (!det.animacion || !det.animacion.includes('ping')) {
          problemas.push(`el punto del estado no tiene animación ping (${det.animacion})`);
        }
        if (!det.visible || !det.antesDelForm || !det.scrollArriba) {
          problemas.push('la tarjeta no está visible arriba del todo');
        }
        if (!det.codigo) problemas.push('la tarjeta no muestra el código del pedido');
      }

      // ── Ficha lateral del mapa: el pedido activo también va arriba ──
      console.log(`[6] cerrando modal y abriendo la ficha de ${conPedido.nombre} en el mapa`);
      await evaluar(`window.__d.cerrarModal(); true`);
      await esperar(600);
      await evaluar(`window.__d.abrirEnMapa(${conPedido.i}); true`);
      let fichaAbierta = false;
      for (let i = 0; i < 20; i++) {
        fichaAbierta = await evaluar(
          `[...document.querySelectorAll('button')].some((x) => x.textContent.includes('Volver a la flota'))`,
        );
        if (fichaAbierta) break;
        await esperar(500);
      }
      await esperar(700);
      const ficha = JSON.parse(await evaluar('window.__d.fichaJson()'));
      console.log(`[7] ficha: ${JSON.stringify(ficha)}`);
      await capturar('driver-ficha-pedido-activo.png');
      if (!fichaAbierta || !ficha.hayPedido) {
        problemas.push('la ficha del mapa no muestra el pedido activo');
      } else {
        if (ficha.ocurrencias !== 1) {
          problemas.push(`sección "Pedido activo" duplicada en la ficha (${ficha.ocurrencias})`);
        }
        if (!ficha.animacion || !ficha.animacion.includes('ping')) {
          problemas.push('la ficha no tiene el pulso de animación');
        }
        if (!ficha.codigo) problemas.push('la ficha no muestra el código del pedido');
        if (ficha.arribaDeEstado !== true) {
          problemas.push('el pedido activo no está sobre "Estado actual"');
        }
      }

      // ── Repartidor sin pedido activo: no debe aparecer la tarjeta ──
      if (sinPedido) {
        console.log(`[8] volviendo a Repartidores para ${sinPedido.nombre} (${sinPedido.estado})`);
        await evaluar(`(() => {
          const b = [...document.querySelectorAll('button')].find(
            (x) => x.textContent.trim() === 'Repartidores' && !x.title,
          );
          if (b) b.click();
          return Boolean(b);
        })()`);
        await esperar(900);
        await evaluar(`window.__d.abrirFila(${sinPedido.i}); true`);
        if (!(await esperarSelector('h2'))) {
          problemas.push('no se abrió el detalle del repartidor sin pedido');
        }
        await esperar(800);
        const det2 = JSON.parse(await evaluar('window.__d.detalle()'));
        console.log(`[9] sin pedido → tarjeta: ${det2.hayTarjeta}`);
        if (det2.hayTarjeta) problemas.push('aparece la tarjeta en un repartidor sin pedido activo');
      } else {
        console.log('[8] no hay repartidor sin pedido activo en la tabla; caso negativo omitido');
      }
    }

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ tarjeta de pedido activo en el detalle OK');
    process.exitCode = problemas.length || errores.length ? 1 : 0;
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-driver-order-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
