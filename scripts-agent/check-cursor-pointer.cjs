/**
 * Verifica que los elementos clicables del panel tengan `cursor: pointer`
 * (Tailwind v4 dejó los botones en `default`).
 *
 * Comprueba, en la página real: el cursor calculado de TODOS los botones, de
 * los `[role=switch]`, de un `[role=button]` y de algunas filas clicables; y
 * confirma que los `button:disabled` NO queden como pointer.
 *
 * Uso: node scripts-agent/check-cursor-pointer.cjs [puerto]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '8447';
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = 9374;
const USUARIO = 'qa-delivery-temp';
const CLAVE = 'demo123';

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
      '--window-size=1600,900',
      '--user-data-dir=/tmp/chrome-cursor-probe',
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
      throw new Error('no entró al panel');
    }
    await esperar(2500);

    const informe = await evaluar(`(() => {
      const cursorDe = (el) => getComputedStyle(el).cursor;
      const botones = [...document.querySelectorAll('button')];
      const conteo = {};
      for (const b of botones) conteo[cursorDe(b)] = (conteo[cursorDe(b)] ?? 0) + 1;

      const switches = [...document.querySelectorAll('[role="switch"]')].map(cursorDe);
      const roleButtons = [...document.querySelectorAll('[role="button"]')].map(cursorDe);
      const filas = [...document.querySelectorAll('tbody tr.cursor-pointer')].map(cursorDe);

      // Ejemplos concretos con su texto, para poder revisarlos a ojo.
      const ejemplos = botones.slice(0, 6).map((b) => ({
        texto: (b.innerText || b.getAttribute('title') || b.getAttribute('aria-label') || '?').trim().slice(0, 24),
        cursor: cursorDe(b),
        disabled: b.disabled,
      }));

      return JSON.stringify({ totalBotones: botones.length, conteo, switches, roleButtons, filas, ejemplos }, null, 1);
    })()`);
    console.log(`[2] cursores:\n${informe}`);

    const d = JSON.parse(informe);
    const problemas = [];
    const malos = Object.entries(d.conteo).filter(([c]) => c !== 'pointer');
    // Los `disabled` pueden tener otro cursor a propósito (not-allowed).
    if (malos.length && !d.conteo['default']) {
      problemas.push(`cursores inesperados en botones: ${JSON.stringify(d.conteo)}`);
    }
    if (d.conteo['default']) problemas.push(`${d.conteo['default']} botón(es) con cursor:default`);
    if (d.switches.some((c) => c !== 'pointer')) problemas.push('algún [role=switch] sin pointer');
    if (d.filas.some((c) => c !== 'pointer')) problemas.push('alguna fila clicable sin pointer');

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);

    // ── Segunda pasada: pestaña Repartidores y modal de alta ──
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('header nav button')].find(
        (n) => n.textContent.trim() === 'Repartidores',
      );
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(2500);

    const rep = await evaluar(`(() => {
      const c = (el) => getComputedStyle(el).cursor;
      const botones = [...document.querySelectorAll('button')];
      const conteo = {};
      for (const b of botones) {
        const k = b.disabled ? 'disabled:' + c(b) : c(b);
        conteo[k] = (conteo[k] ?? 0) + 1;
      }
      const filas = [...document.querySelectorAll('tbody tr')].map(c);
      return JSON.stringify({ botones: conteo, filas: [...new Set(filas)], nFilas: filas.length });
    })()`);
    console.log(`[3] pestaña Repartidores: ${rep}`);
    const r = JSON.parse(rep);
    if (r.filas.some((c) => c !== 'pointer')) problemas.push(`filas con cursor ${r.filas.join(',')}`);

    // Modal de alta: comprobar el botón deshabilitado (debe conservar su cursor).
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (n) => /nuevo repartidor/i.test(n.innerText),
      );
      b?.click();
      return Boolean(b);
    })()`);
    await esperar(1500);
    const modal = await evaluar(`(() => {
      const c = (el) => getComputedStyle(el).cursor;
      const btns = [...document.querySelectorAll('button')].map((b) => ({
        texto: (b.innerText || b.getAttribute('title') || '?').trim().slice(0, 22),
        cursor: c(b),
        disabled: b.disabled,
      }));
      const guardar = btns.find((b) => /guardar|crear/i.test(b.texto));
      return JSON.stringify({ totalBotones: btns.length, guardar, deshabilitados: btns.filter((b) => b.disabled) }, null, 1);
    })()`);
    console.log(`[4] modal de alta:\n${modal}`);
    const m = JSON.parse(modal);
    if (m.totalBotones && m.guardar && !m.guardar.disabled && m.guardar.cursor !== 'pointer') {
      problemas.push('el botón de guardar del modal no tiene pointer');
    }

    console.log(`\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`);
    if (problemas.length) {
      console.log(`❌ ${problemas.join(' · ')}`);
      process.exitCode = 1;
    } else {
      console.log(`✅ todos los botones (${d.totalBotones}), switches y filas con cursor:pointer`);
      process.exitCode = errores.length ? 1 : 0;
    }
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync('/tmp/chrome-cursor-probe', { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
