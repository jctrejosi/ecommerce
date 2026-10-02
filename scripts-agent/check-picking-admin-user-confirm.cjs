/**
 * Verifica los modales de confirmación de la pestaña Usuarios del picking admin:
 *   - "Desactivar" y "Quitar de picking" abren un modal que exige teclear el
 *     nombre del usuario antes de habilitar el botón.
 *   - Con el nombre incorrecto el botón sigue deshabilitado.
 *   - Al confirmar, el modal se cierra y el cambio queda aplicado (se comprueba
 *     contra la base de datos).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-admin-user-confirm.cjs
 */
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');
const fs = require('node:fs');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8446/';
const DEBUG_PORT = 9355;
const ADMIN = { username: 'qa-confirm-admin', password: 'qa-confirm-1234' };
// El usuario objetivo empieza activo y como picker, para poder quitarle ambas cosas.
const TARGET = { username: 'qa-confirm-user', password: 'qa-confirm-5678', name: 'Qa Confirm Target' };

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

const MODAL = `[...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('bg-black/60'))`;

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();
  await db.query('DELETE FROM users WHERE username = ANY($1)', [[ADMIN.username, TARGET.username]]);
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Confirm', true, true, false)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, adminHash],
  );
  const targetHash = await bcrypt.hash(TARGET.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, $4, 'Target', false, true, true)`,
    [`${TARGET.username}@qa.local`, TARGET.username, targetHash, TARGET.name],
  );

  let chrome = null;
  try {
    chrome = spawn(
      '/usr/bin/chromium',
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--window-size=1400,1000', `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=/tmp/cdp-confirm-${Date.now()}`, 'about:blank',
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
    if (!page) throw new Error('Chromium no expuso ninguna página');
    const { ready, send } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send('Page.enable');
    await send('Runtime.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
      return r.result.value;
    };

    // Login y navegación a Usuarios.
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
      if (await evaluate(`document.body.innerText.includes('Usuarios')`)) break;
      await sleep(300);
    }
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Usuarios');
      b?.click(); return true;
    })()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`document.body.innerText.includes('@${TARGET.username}')`)) break;
      await sleep(300);
    }
    check('la pestaña Usuarios lista al usuario objetivo', await evaluate(`document.body.innerText.includes('@${TARGET.username}')`));

    const clickCardAction = (label) =>
      evaluate(`(() => {
        const cards = [...document.querySelectorAll('div')].filter(
          (d) => typeof d.className === 'string' && d.className.includes('bg-surface-alt') && d.textContent.includes('@${TARGET.username}')
        );
        const card = cards.sort((a, b) => a.textContent.length - b.textContent.length)[0];
        if (!card) return 'no-card';
        const b = [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        if (!b) return 'no-button: ' + [...card.querySelectorAll('button')].map((x) => x.textContent.trim()).join(' | ');
        b.click(); return 'ok';
      })()`);

    const modalInfo = () =>
      evaluate(`(() => {
        const m = ${MODAL};
        if (!m) return null;
        const input = m.querySelector('input');
        const buttons = [...m.querySelectorAll('button')];
        const confirmBtn = buttons[buttons.length - 1];
        return {
          title: m.querySelector('h2')?.textContent.trim() ?? null,
          text: m.textContent.replace(/\\s+/g, ' ').trim(),
          hasInput: !!input,
          confirmLabel: confirmBtn?.textContent.trim() ?? null,
          disabled: !!confirmBtn?.disabled,
        };
      })()`);

    const typeInModal = (value) =>
      evaluate(`(() => {
        const m = ${MODAL};
        if (!m) return false;
        const input = m.querySelector('input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);

    const clickConfirm = () =>
      evaluate(`(() => {
        const m = ${MODAL};
        if (!m) return false;
        const buttons = [...m.querySelectorAll('button')];
        buttons[buttons.length - 1].click();
        return true;
      })()`);

    // El nombre a teclear se lee del propio modal (el backend arma el `name`
    // concatenando nombre + apellido, así que no se asume el literal de prueba).
    const expectedFromModal = () =>
      evaluate(`(() => {
        const m = ${MODAL};
        if (!m) return null;
        const t = m.textContent.replace(/\\s+/g, ' ').trim();
        const r = /Escribe (.*?) para confirmar/.exec(t);
        return r ? r[1].trim() : null;
      })()`);

    // ── Quitar de picking ───────────────────────────────────────────────────
    console.log('\n== Quitar de picking ==');
    check('el botón dispara el modal', (await clickCardAction('Quitar de picking')) === 'ok');
    await sleep(250);
    let info = await modalInfo();
    check('el modal pide el nombre', !!info && /Escribe .* para confirmar/i.test(info.text), info?.text?.slice(0, 90));
    check('el título es "Quitar de picking"', info?.title === 'Quitar de picking', info?.title ?? '');
    check('el modal tiene el input del nombre', !!info?.hasInput);
    check('el botón de confirmar arranca deshabilitado', info?.disabled === true);

    await typeInModal(TARGET.name + ' equivocado');
    await sleep(150);
    info = await modalInfo();
    check('con el nombre incorrecto sigue deshabilitado', info?.disabled === true);

    const expected = await expectedFromModal();
    check('el modal indica el nombre a teclear', !!expected, expected ?? '');
    await typeInModal(expected);
    await sleep(150);
    info = await modalInfo();
    check('con el nombre correcto se habilita', info?.disabled === false);

    await clickConfirm();
    await sleep(600);
    check('el modal se cierra al confirmar', (await modalInfo()) === null);
    const afterPicker = await db.query('SELECT is_picker FROM users WHERE username = $1', [TARGET.username]);
    check('el usuario quedó fuera del picking (BD)', afterPicker.rows[0]?.is_picker === false);

    // ── Desactivar ──────────────────────────────────────────────────────────
    console.log('\n== Desactivar ==');
    check('el botón dispara el modal', (await clickCardAction('Desactivar')) === 'ok');
    await sleep(250);
    info = await modalInfo();
    check('el título es "Desactivar usuario"', info?.title === 'Desactivar usuario', info?.title ?? '');
    check('el botón de confirmar arranca deshabilitado', info?.disabled === true);

    // Cerrar sin confirmar (clic en el fondo) deja el usuario intacto.
    await evaluate(`(() => { const m = ${MODAL}; m?.click(); return true; })()`);
    await sleep(200);
    check('clic fuera cierra sin aplicar cambios', (await modalInfo()) === null);
    const stillActive = await db.query('SELECT is_active FROM users WHERE username = $1', [TARGET.username]);
    check('el usuario sigue activo tras cancelar (BD)', stillActive.rows[0]?.is_active === true);

    await clickCardAction('Desactivar');
    await sleep(250);
    await typeInModal(await expectedFromModal());
    await sleep(150);
    await clickConfirm();
    await sleep(600);
    const afterInactive = await db.query('SELECT is_active FROM users WHERE username = $1', [TARGET.username]);
    check('al confirmar queda desactivado (BD)', afterInactive.rows[0]?.is_active === false);

    // ── Cambiar contraseña (modal) ──────────────────────────────────────────
    console.log('\n== Cambiar contraseña ==');
    const cardInputCount = () =>
      evaluate(`(() => {
        const cards = [...document.querySelectorAll('div')].filter(
          (d) => typeof d.className === 'string' && d.className.includes('bg-surface-alt') && d.textContent.includes('@${TARGET.username}')
        );
        const card = cards.sort((a, b) => a.textContent.length - b.textContent.length)[0];
        return card ? card.querySelectorAll('input').length : -1;
      })()`);
    const hashBefore = (
      await db.query('SELECT password_hash FROM users WHERE username = $1', [TARGET.username])
    ).rows[0].password_hash;

    check('la tarjeta no tiene input en línea', (await cardInputCount()) === 0, String(await cardInputCount()));
    check('el botón dispara el modal', (await clickCardAction('Cambiar contraseña')) === 'ok');
    await sleep(250);
    info = await modalInfo();
    check('el título es "Cambiar contraseña"', info?.title === 'Cambiar contraseña', info?.title ?? '');
    check('el modal tiene el input de contraseña', info?.hasInput === true);
    check('la tarjeta sigue sin input en línea', (await cardInputCount()) === 0);
    check('el botón arranca deshabilitado', info?.disabled === true);

    await typeInModal('1234567');
    await sleep(150);
    info = await modalInfo();
    check('con 7 caracteres sigue deshabilitado', info?.disabled === true);

    await typeInModal('nueva-clave-123');
    await sleep(150);
    info = await modalInfo();
    check('con 8+ caracteres se habilita', info?.disabled === false);

    await clickConfirm();
    await sleep(700);
    check('el modal se cierra al guardar', (await modalInfo()) === null);
    const hashAfter = (
      await db.query('SELECT password_hash FROM users WHERE username = $1', [TARGET.username])
    ).rows[0].password_hash;
    check('la contraseña cambió en la BD', hashAfter !== hashBefore);

    // Captura con el modal de contraseña abierto para revisión visual.
    await clickCardAction('Cambiar contraseña');
    await sleep(300);
    await typeInModal('nueva-clave-123');
    await sleep(200);
    const btnStyle = await evaluate(`(() => {
      const m = ${MODAL};
      const b = [...m.querySelectorAll('button')].pop();
      const cs = getComputedStyle(b);
      return { bg: cs.backgroundColor, opacity: cs.opacity, disabled: b.disabled };
    })()`);
    console.log('    confirm btn:', JSON.stringify(btnStyle));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('scripts-agent/.scratch', { recursive: true });
    fs.writeFileSync('scripts-agent/.scratch/picking-admin-user-password.png', Buffer.from(shot.data, 'base64'));
    console.log('\n  captura: scripts-agent/.scratch/picking-admin-user-password.png');
  } finally {
    chrome?.kill('SIGKILL');
    await db.query('DELETE FROM users WHERE username = ANY($1)', [[ADMIN.username, TARGET.username]]);
    await db.end();
    console.log('\n  limpieza: usuarios temporales eliminados');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
