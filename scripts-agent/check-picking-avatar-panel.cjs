/**
 * Verifica que la foto que sube el picker desde la app se ve en el panel de
 * picking admin (pestaña Usuarios y pestaña Pickers).
 *
 * Crea un usuario temporal, le sube una foto por el endpoint real del picker
 * (multipart → Cloudinary), abre el panel en Chromium, comprueba los `<img>` y
 * borra el usuario al final (pase lo que pase).
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/check-picking-avatar-panel.cjs
 */
const { spawn } = require('node:child_process');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DEBUG_PORT = 9335;
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const API = process.env.BASE_URL || 'http://127.0.0.1:3000';
const SHOT = 'scripts-agent/.scratch/picking-avatar-panel.png';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const QA = {
  username: 'qa-avatar-panel',
  email: 'qa-avatar-panel@local.test',
  firstName: 'Qa',
  lastName: 'Foto',
  password: 'qa-clave-1234',
};

let failures = 0;
let checks = 0;
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
  return { ws, ready, send };
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  let chrome = null;
  let cdp = null;
  let qaId = null;

  try {
    // ── Usuario temporal con foto subida por el endpoint real ─────────────────
    await db.query('DELETE FROM users WHERE username = $1', [QA.username]);
    const ins = await db.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name,
                          is_superuser, is_active, is_picker)
       VALUES ($1, $2, $3, $4, $5, false, true, true)
       RETURNING id`,
      [QA.email, QA.username, await bcrypt.hash(QA.password, 10), QA.firstName, QA.lastName],
    );
    qaId = Number(ins.rows[0].id);

    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: QA.username, password: QA.password }),
    }).then((r) => r.json());

    const png = readFileSync('Interface movil picking/assets/picking.png');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'qa-avatar.png');
    const up = await fetch(`${API}/picking/profile/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.accessToken}` },
      body: form,
    });
    const upBody = await up.json().catch(() => null);
    const avatarUrl = upBody?.avatarUrl;
    console.log(`[setup] usuario temporal ${QA.username} (id ${qaId}) con foto ${String(avatarUrl).slice(0, 70)}`);
    check(`subida de la foto -> ${up.status}`, up.ok && !!avatarUrl);

    // ── Panel ─────────────────────────────────────────────────────────────────
    const adminHash = (
      await db.query(`SELECT password_hash FROM users WHERE username = 'admin'`)
    ).rows[0]?.password_hash;
    const adminPass = ['admdsi4231', 'admin123'].find((p) =>
      bcrypt.compareSync(p, adminHash ?? ''),
    );
    if (!adminPass) throw new Error('No se pudo resolver la contraseña del admin');

    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1200,1000',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-avatar-${Date.now()}`,
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

    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    const { send } = cdp;
    await send('Page.enable');
    await send('Runtime.enable');

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      return r.result.value;
    };
    const until = async (expression, label, tries = 60) => {
      for (let i = 0; i < tries; i++) {
        if (await evaluate(expression)) return true;
        await sleep(250);
      }
      throw new Error(`Timeout esperando: ${label}`);
    };

    await send('Page.navigate', { url: PANEL_URL });
    await until(`!!document.querySelector('form input')`, 'el login del panel');
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const [user, pass] = document.querySelectorAll('form input');
      setter.call(user, 'admin'); user.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pass, ${JSON.stringify(adminPass)}); pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    await until(`document.body.innerText.includes('Estanterías')`, 'el panel tras el login');

    /** Comprueba que el <img> del usuario temporal está pintado y cargó. */
    const verificarFoto = async (pestana) => {
      await evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(pestana)});
        b.click(); return true;
      })()`);
      await until(
        `[...document.querySelectorAll('img')].some((i) => (i.currentSrc || i.src).includes('picking/users/${qaId}/') && i.complete && i.naturalWidth > 0)`,
        `la foto cargada en la pestaña ${pestana}`,
        60,
      );
      const info = await evaluate(`(() => {
        const img = [...document.querySelectorAll('img')].find((i) => (i.currentSrc || i.src).includes('picking/users/${qaId}/'));
        if (!img) return null;
        const r = img.getBoundingClientRect();
        return {
          src: img.currentSrc || img.src,
          natural: [img.naturalWidth, img.naturalHeight],
          caja: [Math.round(r.width), Math.round(r.height)],
          redonda: getComputedStyle(img).borderRadius,
        };
      })()`);
      check(`la foto aparece en la pestaña "${pestana}"`, !!info, info?.src?.slice(0, 70));
      check(
        `y carga de verdad en "${pestana}" (${info?.natural?.join('x')} natural, caja ${info?.caja?.join('x')}, radio ${info?.redonda})`,
        !!info && info.natural[0] > 0 && info.caja[0] > 0 && parseFloat(info.redonda) > 0,
      );
      return info;
    };

    console.log('\n== La foto en el panel ==');
    await verificarFoto('Usuarios');

    mkdirSync('scripts-agent/.scratch', { recursive: true });
    // Vuelve a Usuarios para la captura.
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Usuarios');
      b.click(); return true;
    })()`);
    await until(`document.body.innerText.includes('@${QA.username}')`, 'la fila del usuario temporal');
    await sleep(500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    console.log(`\n  captura: ${SHOT}`);
  } finally {
    cdp?.ws.close();
    chrome?.kill('SIGKILL');
    if (qaId !== null) {
      const del = await db.query('DELETE FROM users WHERE id = $1', [qaId]);
      console.log(`\n  limpieza: usuario temporal ${del.rowCount > 0 ? 'eliminado' : 'NO eliminado (revisar)'}`);
    }
    await db.end();
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
