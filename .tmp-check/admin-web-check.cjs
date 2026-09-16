/*
 * Verificación del panel de picking con Chromium headless (CDP).
 *
 * Entra con una cookie de sesión firmada (mismo JWT que usa el panel), navega la
 * pestaña "Pickers", abre el chat de un picker, envía un mensaje y comprueba que
 * quedó guardado en el backend.
 *
 * Uso: node .tmp-check/admin-web-check.cjs [puertoDebug] [outPrefix]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const ROOT = '/home/jk/Proyectos/dsi/ecommerce';
const PANEL = 'http://localhost:8446';
const API = 'http://localhost:3000';
const DEBUG_PORT = Number(process.argv[2] ?? 9333);
const OUT = process.argv[3] ?? 'admin';

const env = fs.readFileSync(path.join(ROOT, 'backend/.env.development.local'), 'utf8');
const JWT_SECRET = /^JWT_SECRET=(.*)$/m.exec(env)[1].trim();
const ADMIN_TOKEN = jwt.sign(
  { sub: 1, email: 'admin@mercaldas.com.co', username: 'admin', isSuperuser: true },
  JWT_SECRET,
  { expiresIn: '1h' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'error en evaluate');
    return r.result?.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, '.tmp-check', file), Buffer.from(r.data, 'base64'));
    return file;
  }
}

(async () => {
  const chrome = spawn(
    'chromium',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--hide-scrollbars',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--user-data-dir=/tmp/chrome-dsi-check',
      '--window-size=1280,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let version = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      version = await res.json();
      break;
    } catch {
      /* todavía no arranca */
    }
  }
  if (!version) {
    chrome.kill();
    throw new Error('Chromium no expuso el puerto de depuración');
  }

  // Ojo: el WebSocket del navegador NO acepta comandos de página (Page.*).
  // Hay que conectarse al target de la pestaña.
  let target = null;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const list = await res.json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
    await sleep(300);
  }
  if (!target) {
    chrome.kill();
    throw new Error('No hay ninguna pestaña depurable');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const cdp = new Cdp(ws);

  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');

  // Sesión del panel: la cookie httpOnly que el backend emite en /auth/login.
  await cdp.send('Network.setCookie', {
    name: 'access_token',
    value: ADMIN_TOKEN,
    url: PANEL + '/',
    httpOnly: true,
    path: '/',
  });

  await cdp.send('Page.navigate', { url: PANEL });
  await sleep(3500);

  const title = await cdp.eval('document.title');
  console.log('título de la página:', title);

  // Pestaña "Pickers"
  const tapped = await cdp.eval(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.textContent.trim() === 'Pickers'
      );
      if (!b) return false;
      b.click();
      return true;
    })()
  `);
  console.log('pestaña Pickers encontrada:', tapped);
  await sleep(2500);

  const info = await cdp.eval(`
    (() => {
      const buttons = [...document.querySelectorAll('button')].map((b, i) => ({
        i,
        label: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        text: b.textContent.trim().slice(0, 40),
        hasSvg: Boolean(b.querySelector('svg')),
        cls: String(b.className).slice(0, 80),
      }));
      return { buttons, bodyText: document.body.innerText };
    })()
  `);
  console.log('--- botones ---');
  for (const b of info.buttons) {
    console.log(
      `  #${b.i} text=${JSON.stringify(b.text)} label=${JSON.stringify(b.label)} svg=${b.hasSvg}`,
    );
  }
  console.log('--- texto visible ---\n' + info.bodyText.slice(0, 500));

  // Abrir el chat del picker: es el botón sin texto que lleva el SVG de burbuja.
  const opened = await cdp.eval(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.querySelector('svg') && !x.textContent.trim()
      );
      if (!b) return false;
      b.click();
      return true;
    })()
  `);
  console.log('botón de chat pulsado:', opened);
  await sleep(2500);

  const modal = await cdp.eval(`
    (() => {
      const fields = [...document.querySelectorAll('input, textarea')].map((f) => ({
        tag: f.tagName,
        type: f.getAttribute('type'),
        placeholder: f.getAttribute('placeholder'),
      }));
      const buttons = [...document.querySelectorAll('button')].map((b, i) => ({
        i,
        text: b.textContent.trim().slice(0, 30),
        hasSvg: Boolean(b.querySelector('svg')),
        disabled: b.disabled,
      }));
      return { fields, buttons, text: document.body.innerText };
    })()
  `);
  console.log('--- campos ---', JSON.stringify(modal.fields));
  console.log('--- botones tras abrir ---');
  for (const b of modal.buttons) {
    console.log(`  #${b.i} text=${JSON.stringify(b.text)} svg=${b.hasSvg} disabled=${b.disabled}`);
  }
  console.log('--- texto del modal ---\n' + modal.text.slice(-600));
  console.log('captura (modal abierto):', await cdp.shot(`${OUT}-chat.png`));

  // Escribir en el input controlado por React: hay que usar el setter nativo y
  // disparar 'input', si no React no ve el cambio.
  const TEXTO = `Mensaje de prueba del panel ${Date.now()}`;
  const typed = await cdp.eval(`
    (() => {
      const el = document.querySelector('input[placeholder="Escribe un mensaje…"]');
      if (!el) return 'sin input';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(TEXTO)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()
  `);
  console.log('texto escrito:', typed);
  await sleep(800);

  const sent = await cdp.eval(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Enviar');
      if (!b) return 'sin botón';
      if (b.disabled) return 'botón deshabilitado';
      b.click();
      return 'pulsado';
    })()
  `);
  console.log('envío:', sent);
  await sleep(2500);

  const after = await cdp.eval('document.body.innerText');
  console.log('¿el mensaje aparece en el modal?', after.includes(TEXTO));
  console.log('captura (tras enviar):', await cdp.shot(`${OUT}-enviado.png`));

  // Comprobación en la base de datos.
  const { Client } = require('pg');
  const db = new Client('postgresql://postgres:postgres@localhost:5432/ecommerce');
  await db.connect();
  const { rows } = await db.query(
    'select id, picker_id, sender_type, body from picker_chat_messages where body = $1',
    [TEXTO],
  );
  console.log('en la BD:', JSON.stringify(rows));
  const del = await db.query('delete from picker_chat_messages where body = $1', [TEXTO]);
  console.log(`limpieza: ${del.rowCount} mensaje(s) de prueba borrados`);
  await db.end();
  console.log('--- texto visible ---\n' + info.bodyStart);
  console.log('captura:', await cdp.shot(`${OUT}-pickers.png`));

  ws.close();
  chrome.kill();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
