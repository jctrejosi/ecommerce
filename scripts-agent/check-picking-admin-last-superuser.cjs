/**
 * Verifica la protección para no quedarse sin superusuario:
 *   1. Un superusuario no puede desactivar su propia cuenta.
 *   2. Nadie puede desactivar al último superusuario activo.
 *   3. La UI deshabilita ese botón y explica por qué.
 *
 * Crea un superusuario temporal (nunca usa credenciales reales) y restaura
 * siempre el estado del superusuario original.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-last-superuser.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9361;
const TEMP = { username: 'qa-last-super', password: 'qa-last-super-1234' };

let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, json };
}

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
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  const primes = await db.query('SELECT id, username, is_superuser, is_active FROM users WHERE is_superuser = true AND is_active = true ORDER BY id');
  console.log('Superusuarios activos al empezar:', JSON.stringify(primes.rows));

  await db.query('DELETE FROM users WHERE username = $1', [TEMP.username]);
  const hash = await bcrypt.hash(TEMP.password, 10);
  const inserted = await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'LastSuper', true, true, true) RETURNING id`,
    [`${TEMP.username}@qa.local`, TEMP.username, hash],
  );
  const tempId = inserted.rows[0].id;

  // Superusuario original (el que ya existía) para restaurarlo pase lo que pase.
  const originalIds = primes.rows.filter((r) => r.username !== TEMP.username).map((r) => r.id);

  let chrome = null;
  try {
    const login = await api('/auth/login', {
      method: 'POST',
      body: { identifier: TEMP.username, password: TEMP.password },
    });
    check('login del superusuario temporal', login.status === 200 && !!login.json?.accessToken, `HTTP ${login.status}`);
    const token = login.json?.accessToken;

    // ── 1. No desactivarse a sí mismo (hay otro superusuario activo) ────────
    console.log('\n== No desactivar la propia cuenta ==');
    const self = await api(`/picking-admin/users/${tempId}`, { method: 'PUT', body: { isActive: false }, token });
    check('rechaza desactivar la propia cuenta', self.status === 409, `HTTP ${self.status} · ${self.json?.message ?? ''}`);
    check('el mensaje menciona la propia cuenta', /propia cuenta/i.test(self.json?.message ?? ''), self.json?.message ?? '');

    // ── 2. Sí puede desactivar a otro superusuario (no se sobrebloquea) ────
    console.log('\n== Desactivar a otro superusuario (permitido) ==');
    const otherId = originalIds[0];
    const other = await api(`/picking-admin/users/${otherId}`, { method: 'PUT', body: { isActive: false }, token });
    check('permite desactivar a otro superusuario', other.status === 200, `HTTP ${other.status} · ${other.json?.message ?? ''}`);
    const afterOther = await db.query('SELECT is_active FROM users WHERE id = $1', [otherId]);
    check('el otro superusuario quedó inactivo (BD)', afterOther.rows[0]?.is_active === false);

    // ── 3. Ahora es el último superusuario activo y no puede desactivarse ──
    console.log('\n== No dejar el sistema sin superusuario ==');
    const last = await api(`/picking-admin/users/${tempId}`, { method: 'PUT', body: { isActive: false }, token });
    check('rechaza desactivar al último superusuario activo', last.status === 409, `HTTP ${last.status} · ${last.json?.message ?? ''}`);
    check('el mensaje menciona al último superusuario', /último superusuario/i.test(last.json?.message ?? ''), last.json?.message ?? '');
    const stillActive = await db.query('SELECT is_active FROM users WHERE id = $1', [tempId]);
    check('el superusuario temporal sigue activo (BD)', stillActive.rows[0]?.is_active === true);

    // ── 4. UI: el botón del propio usuario queda deshabilitado ─────────────
    console.log('\n== UI: botón deshabilitado ==');
    // Se reactiva al superusuario original para que en la UI el bloqueo a
    // comprobar sea el de "propia cuenta".
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [otherId]);

    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-lastsuper-${Date.now()}`, 'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let targets = null;
    for (let i = 0; i < 40; i++) {
      targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).catch(() => null);
      if (targets?.some((t) => t.type === 'page')) break;
      await sleep(250);
    }
    const page = targets?.find((t) => t.type === 'page');
    const { ready, send } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send('Page.enable');
    await send('Runtime.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
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
      setter.call(user, ${JSON.stringify(TEMP.username)}); user.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pass, ${JSON.stringify(TEMP.password)}); pass.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type=submit]').click();
      return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('Usuarios')`)) break;
      await sleep(300);
    }
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Usuarios'); b?.click(); return true; })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('@${TEMP.username}')`)) break;
      await sleep(300);
    }

    const cardButton = (username, label) =>
      evaluate(`(() => {
        const cards = [...document.querySelectorAll('div')].filter(
          (d) => typeof d.className === 'string' && d.className.includes('bg-surface-alt') && d.textContent.includes('@${username}')
        );
        const card = cards.sort((a, b) => a.textContent.length - b.textContent.length)[0];
        if (!card) return { found: false };
        const b = [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        if (!b) return { found: false };
        return { found: true, disabled: !!b.disabled, title: b.title };
      })()`);

    const own = await cardButton(TEMP.username, 'Desactivar');
    check('la tarjeta propia tiene el botón Desactivar', own?.found === true);
    check('el botón Desactivar propio está deshabilitado', own?.disabled === true);
    check('el botón explica el motivo', /cuenta|superusuario/i.test(own?.title ?? ''), own?.title ?? '');
    const hint = await evaluate(`document.body.innerText.includes('No puedes desactivar tu propia cuenta')`);
    check('la tarjeta muestra el aviso de bloqueo', hint === true);

    // Deja visible la tarjeta propia para la captura.
    await evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(
        (d) => typeof d.className === 'string' && d.className.includes('bg-surface-alt') && d.textContent.includes('@${TEMP.username}')
      );
      const card = cards.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      card?.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    await sleep(400);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('node:fs').mkdirSync('scripts-agent/.scratch', { recursive: true });
    require('node:fs').writeFileSync('scripts-agent/.scratch/picking-admin-last-superuser.png', Buffer.from(shot.data, 'base64'));
    console.log('\n  captura: scripts-agent/.scratch/picking-admin-last-superuser.png');
  } finally {
    chrome?.kill('SIGKILL');
    // Restauración: el superusuario original siempre vuelve a estar activo.
    if (originalIds.length) {
      await db.query('UPDATE users SET is_active = true WHERE id = ANY($1)', [originalIds]);
    }
    await db.query('DELETE FROM users WHERE username = $1', [TEMP.username]);
    const finalRows = await db.query('SELECT id, username, is_active FROM users WHERE is_superuser = true ORDER BY id');
    console.log('\n  estado final:', JSON.stringify(finalRows.rows));
    await db.end();
    console.log('  limpieza: superusuario temporal eliminado y originales reactivados');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
