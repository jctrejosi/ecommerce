/**
 * Verifica el chat del panel de picking admin:
 *   1. el botón de chat está en el header, al lado del botón del usuario,
 *   2. al llegar un mensaje de un picker sube el badge de no leídos y salta el
 *      aviso (toast),
 *   3. la bandeja lista una conversación por picker y abre el hilo al elegirla,
 *   4. al leer el hilo el badge baja,
 *   5. el chat por picker de la pestaña Pickers sigue funcionando.
 *
 * Usa un picker y un administrador temporales y borra todo al terminar.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-chat.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9338;
const PICKER = { username: 'qa-chat-picker', password: 'qa-chat-1234' };
const ADMIN = { username: 'qa-chat-admin', password: 'qa-chat-5678' };
const MSG = '[qa-chat] Hola, necesito ayuda con un pedido.';

let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('no se pudo abrir el socket CDP')));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send };
}

async function main() {
  const DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/ecommerce';
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const cleanup = async () => {
    await db.query('DELETE FROM picker_chat_messages WHERE body = $1', [MSG]);
    await db.query('DELETE FROM users WHERE username = ANY($1)', [
      [PICKER.username, ADMIN.username],
    ]);
  };
  await cleanup();

  // Picker temporal (es a quien se le escribe y desde quien se escribe).
  const pickerHash = await bcrypt.hash(PICKER.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'ChatPicker', false, true, true)`,
    [`${PICKER.username}@qa.local`, PICKER.username, pickerHash],
  );
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'ChatAdmin', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, adminHash],
  );

  let chrome = null;
  try {
    // Token del picker para escribir como él.
    const pickerLogin = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: PICKER.username,
        password: PICKER.password,
      }),
    });
    const pickerTokens = await pickerLogin.json();
    check('login del picker temporal', pickerLogin.status === 200, `HTTP ${pickerLogin.status}`);

    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1400,1000',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-chat-${Date.now()}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        .then((r) => r.json())
        .catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets?.find((t) => t.type === 'page');
    if (!page) throw new Error('Chromium no expuso ninguna página');

    const cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    const { send } = cdp;
    await send('Page.enable');
    await send('Runtime.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      return r.result.value;
    };

    await send('Page.navigate', { url: PANEL_URL });
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`!!document.querySelector('form input')`)) break;
      await sleep(250);
    }
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const [user, pass] = document.querySelectorAll('form input');
      setter.call(user, ${JSON.stringify(ADMIN.username)}); user.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pass, ${JSON.stringify(ADMIN.password)}); pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('Estanterías')`)) break;
      await sleep(250);
    }

    const CHAT_BTN = `document.querySelector('header button[aria-label="Chat con los pickers"]')`;
    const badgeCount = () =>
      evaluate(`(() => {
        const s = ${CHAT_BTN}?.querySelector('span');
        return s ? Number(s.textContent.replace('+','')) || 0 : 0;
      })()`);

    console.log('== Botón de chat en el header ==');
    const inHeader = await evaluate(`!!${CHAT_BTN}`);
    check('existe el botón de chat en el header', inHeader);
    const nextToUser = await evaluate(
      `(() => {
        const b = ${CHAT_BTN};
        const next = b?.nextElementSibling;
        return !!next && next.textContent.includes('Administrador');
      })()`,
    );
    check('está al lado del botón del usuario', nextToUser);

    // El panel abre el socket al entrar: se le da un momento para que esté
    // conectado (si el mensaje llega antes, el aviso en vivo se pierde y solo
    // lo recogería el sondeo de respaldo).
    await sleep(3000)

    // Espía de la Notification del navegador: ese es el aviso que se espera
    // (más el punto con el número en el botón), no un popup del panel.
    await evaluate(`(() => {
      window.__notifs = [];
      class NotificationSpy {
        constructor(title, opts) {
          window.__notifs.push({ title, body: opts?.body ?? null });
        }
        close() {}
      }
      NotificationSpy.permission = 'granted';
      NotificationSpy.requestPermission = async () => 'granted';
      window.Notification = NotificationSpy;
      return true;
    })()`)

    console.log('\n== Alerta al llegar un mensaje del picker ==')
    const before = await badgeCount()
    const res = await fetch(`${BASE}/picking/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pickerTokens.accessToken}`,
      },
      body: JSON.stringify({ body: MSG }),
    })
    check('el picker envía el mensaje', res.status === 201, `HTTP ${res.status}`)

    // El badge debe subir por el evento en vivo: se le da margen.
    let after = before
    for (let i = 0; i < 12; i++) {
      await sleep(500)
      after = await badgeCount()
      if (after > before) break
    }
    check(
      'el badge de no leídos sube',
      after === before + 1,
      `antes=${before} después=${after}`,
    );
    const popup = await evaluate(
      `(() => {
        const t = document.querySelector('.animate-slide-down');
        return t ? t.innerText.trim() : null;
      })()`,
    )
    check('no aparece ningún popup interno del panel', popup === null, popup ?? 'sin popup')

    const notifs = await evaluate(`window.__notifs`)
    check(
      'se dispara la notificación del navegador',
      Array.isArray(notifs) && notifs.length === 1,
      JSON.stringify(notifs?.[0] ?? null),
    )
    check(
      'la notificación trae el nombre del picker y el mensaje',
      !!notifs?.[0]?.title?.includes('Qa ChatPicker') && notifs?.[0]?.body === MSG,
      notifs?.[0]?.title ?? 'sin notificación',
    )

    console.log('\n== Bandeja: un hilo por picker ==');
    await evaluate(`${CHAT_BTN}.click()`);
    await sleep(1200);
    const drawerOpen = await evaluate(
      `document.body.innerText.includes('Mensajes de pickers')`,
    );
    check('se abre la bandeja del header', drawerOpen);
    const hasRow = await evaluate(
      `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Qa ChatPicker'))`,
    );
    check('la bandeja lista al picker', hasRow);

    // Evidencia: la bandeja abierta con el badge de no leídos en el header.
    const drawerShot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-admin-chat-drawer.png',
      Buffer.from(drawerShot.data, 'base64'),
    );

    // Abrir su hilo.
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Qa ChatPicker'));
      b?.click(); return !!b;
    })()`);
    await sleep(1500);
    const threadOpen = await evaluate(
      `document.body.innerText.includes('Conversación del picker') && document.body.innerText.includes(${JSON.stringify(MSG)})`,
    );
    check('el hilo muestra el mensaje del picker', threadOpen);

    // Al leerlo, el badge debe bajar.
    await sleep(1500);
    const afterRead = await badgeCount();
    check(
      'al leer el hilo baja el badge',
      afterRead === before,
      `antes=${before} leído=${afterRead}`,
    );

    // Cerrar la bandeja.
    await evaluate(
      `document.querySelector('button[aria-label="Cerrar chat"]')?.click()`,
    );
    await sleep(600);
    const closed = await evaluate(
      `!document.body.innerText.includes('Mensajes de pickers')`,
    );
    check('la bandeja se cierra', closed);

    console.log('\n== Chat por picker en la pestaña Pickers ==');
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Pickers');
      b?.click(); return !!b;
    })()`);
    // La pestaña carga las métricas: hay que esperar a que terminen.
    for (let i = 0; i < 60; i++) {
      const done = await evaluate(
        `document.body.innerText.includes('Estado en vivo') && !document.body.innerText.includes('Actualizando…')`,
      );
      if (done) break;
      await sleep(300);
    }
    const cardChat = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('button[title="Conversación con el picker"]')];
      return btns.length;
    })()`);
    check('las tarjetas de pickers tienen botón de chat', cardChat > 0, `${cardChat} tarjeta(s)`);

    // Abrir el hilo del picker temporal desde su tarjeta: se localiza el nombre
    // exacto y se sube hasta el primer ancestro que tenga el botón de chat (la
    // tarjeta), sin confundirse con el contenedor de todas las tarjetas.
    const opened = await evaluate(`(() => {
      const nameEl = [...document.querySelectorAll('p, span, h2, h3')].find(
        (el) => el.textContent.trim() === 'Qa ChatPicker',
      );
      let card = nameEl;
      while (card && !card.querySelector?.('button[title="Conversación con el picker"]')) {
        card = card.parentElement;
      }
      const btn = card?.querySelector('button[title="Conversación con el picker"]');
      btn?.click();
      return !!btn;
    })()`);
    check('se abre el chat desde la tarjeta del picker', opened);
    await sleep(2000);
    const inCard = await evaluate(
      `document.body.innerText.includes('Conversación del picker') && document.body.innerText.includes(${JSON.stringify(MSG)})`,
    );
    check('el hilo de la tarjeta muestra el mensaje', inCard);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync(
      'scripts-agent/.scratch/picking-admin-chat.png',
      Buffer.from(shot.data, 'base64'),
    );
    console.log('\n  captura: scripts-agent/.scratch/picking-admin-chat.png');
  } finally {
    chrome?.kill('SIGKILL');
    await cleanup();
    await db.end();
    console.log('\n  limpieza: picker, admin y mensajes temporales eliminados');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
