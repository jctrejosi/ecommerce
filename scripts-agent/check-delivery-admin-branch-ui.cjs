/**
 * Verifica en la UI del panel delivery-admin (Chromium headless + CDP):
 *  - el selector de sucursal en la barra superior (opciones y si está fijado),
 *  - el filtro aplicado a la pestaña "Repartidores",
 *  - el filtro aplicado al cambiar de sucursal.
 *
 * Compara contra lo que devuelve la API con el mismo usuario (fuente de verdad),
 * así no hay conteos hardcodeados.
 *
 * Uso: node scripts-agent/check-delivery-admin-branch-ui.cjs <usuario> <clave>
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.DELIVERY_ADMIN_PORT || '8447';
const URL = `http://localhost:${PORT}/`;
const API = process.env.API_BASE || 'http://localhost:3000';
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9485);
const USUARIO = process.argv[2] || 'qa-delivery-temp';
const CLAVE = process.argv[3] || 'demo123';
const OUT_DIR = path.join(__dirname, '.scratch');
const USER_DIR = `/tmp/chrome-deliv-branch-${Date.now()}`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
function check(name, ok, detail = '') {
  if (!ok) fallos += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USUARIO, password: CLAVE }),
  });
  if (!res.ok) throw new Error(`login ${USUARIO} → ${res.status}`);
  return res.json();
}

async function apiGet(p, token) {
  const res = await fetch(`${API}${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function esperarDevtools() {
  for (let i = 0; i < 80; i++) {
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
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── Fuente de verdad (API) ──
  const auth = await apiLogin();
  const token = auth.accessToken;
  const scoped = auth.user?.branchId != null;
  const expectedBranches = await apiGet('/delivery/admin/branches', token);
  const expectedDriversAll = await apiGet('/delivery/admin/drivers', token);
  console.log(
    `\nAPI: usuario=${USUARIO} scoped=${scoped} branchId=${auth.user?.branchId ?? 'null'} ` +
      `branches=${expectedBranches.length} drivers=${expectedDriversAll.length}`,
  );

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
      `--user-data-dir=${USER_DIR}`,
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
    const esperarSelector = async (selector, intentos = 100) => {
      for (let i = 0; i < intentos; i++) {
        if (await evaluar(`!!document.querySelector(${JSON.stringify(selector)})`)) return true;
        await esperar(400);
      }
      return false;
    };

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await enviar('Page.enable');
    await enviar('Runtime.enable');

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
    if (!(await esperarSelector('header select', 140))) {
      // Sin selector: o no hay sucursales, o falló el login.
      const logged = await evaluar(`!!document.querySelector('header img')`);
      if (!logged) throw new Error('no entró al panel');
      throw new Error('el header no tiene el selector de sucursal');
    }
    await esperar(2500);

    // ── Selector de sucursal ──
    console.log('\n=== Selector de sucursal (header) ===');
    const sel = await evaluar(`(() => {
      const el = document.querySelector('header select');
      return JSON.stringify({
        disabled: el.disabled,
        options: [...el.options].map((o) => o.textContent.trim()),
        value: el.value,
      });
    })()`);
    const selInfo = JSON.parse(sel);
    console.log(JSON.stringify(selInfo));

    const expectedNames = expectedBranches.map((b) => b.name);
    if (scoped) {
      check('selector fijado (disabled)', selInfo.disabled === true);
      check(
        'muestra solo su sucursal',
        selInfo.options.length === 1 && expectedNames.includes(selInfo.options[0]),
        `opciones=${selInfo.options.join(', ')}`,
      );
    } else {
      check('selector habilitado', selInfo.disabled === false);
      check('incluye la opción "Todas las sucursales"', selInfo.options[0] === 'Todas las sucursales');
      check(
        `lista las ${expectedNames.length} sucursales`,
        expectedNames.every((n) => selInfo.options.includes(n)),
        `opciones=${selInfo.options.join(', ')}`,
      );
    }

    // ── Filtro en "Repartidores" ──
    const contarRepartidores = async () => {
      const txt = await evaluar(`(() => {
        const p = [...document.querySelectorAll('p')].find((el) => /registrados/.test(el.textContent));
        return p ? p.textContent : '';
      })()`);
      const m = /(\d+)\s+registrados/.exec(txt || '');
      return m ? Number(m[1]) : null;
    };
    const irATab = async (label) => {
      await evaluar(`(() => {
        const b = [...document.querySelectorAll('nav button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        if (b) b.click();
        return !!b;
      })()`);
      await esperar(1200);
    };

    console.log('\n=== Filtro en Repartidores ===');
    await irATab('Repartidores');
    await esperar(800);
    const nAll = await contarRepartidores();
    check(
      `la lista muestra los ${expectedDriversAll.length} repartidores de la API`,
      nAll === expectedDriversAll.length,
      `UI=${nAll} API=${expectedDriversAll.length}`,
    );

    if (!scoped && expectedBranches.length > 0) {
      const target = expectedBranches[0];
      const expectedByBranch = await apiGet(
        `/delivery/admin/drivers?branchId=${target.id}`,
        token,
      );
      await irATab('Repartidores'); // asegura estar en la pestaña
      await evaluar(`(() => {
        const el = document.querySelector('header select');
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(String(target.id))});
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await esperar(2500);
      await irATab('Repartidores');
      const nBranch = await contarRepartidores();
      check(
        `al filtrar por "${target.name}" muestra ${expectedByBranch.length}`,
        nBranch === expectedByBranch.length,
        `UI=${nBranch} API=${expectedByBranch.length}`,
      );

      // Persistencia: cambiar a Pedidos y volver a Repartidores debe mantener el filtro.
      await irATab('Pedidos');
      await esperar(1500);
      const selTrasTab = await evaluar(`document.querySelector('header select').value`);
      check(
        'el filtro persiste al cambiar de pestaña',
        selTrasTab === String(target.id),
        `select=${selTrasTab}`,
      );
      await irATab('Repartidores');
      const nBranch2 = await contarRepartidores();
      check('el filtro sigue aplicado al volver', nBranch2 === expectedByBranch.length, `UI=${nBranch2}`);
    }

    // ── Selector de sucursal en el modal de repartidor ──
    console.log('\n=== Modal de repartidor (selector de sucursal) ===');
    await irATab('Repartidores');
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Nuevo repartidor');
      if (b) b.click();
      return !!b;
    })()`);
    await esperar(1200);
    const modal = await evaluar(`(() => {
      const span = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === 'Sucursal');
      if (!span) return JSON.stringify({ found: false });
      const label = span.closest('label');
      const select = label?.querySelector('select');
      return JSON.stringify({
        found: true,
        hasSelect: !!select,
        options: select ? [...select.options].map((o) => o.textContent.trim()) : [],
        fija: /Fija/.test(label?.textContent ?? ''),
      });
    })()`);
    const modalInfo = JSON.parse(modal);
    console.log(JSON.stringify(modalInfo));
    {
      const shotModal = await enviar('Page.captureScreenshot', { format: 'png' });
      if (shotModal?.data) {
        fs.writeFileSync(
          path.join(OUT_DIR, `delivery-branch-modal-${USUARIO}.png`),
          Buffer.from(shotModal.data, 'base64'),
        );
      }
    }
    if (scoped) {
      check('sucursal fija en el modal (sin selector)', modalInfo.found && !modalInfo.hasSelect && modalInfo.fija);
    } else {
      check(
        'el modal permite elegir sucursal',
        modalInfo.found && modalInfo.hasSelect && modalInfo.options[0] === 'Sin sucursal' &&
          expectedBranches.every((b) => modalInfo.options.includes(b.name)),
        `opciones=${modalInfo.options?.join(', ')}`,
      );
    }
    // Cierra el modal sin guardar.
    await evaluar(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cancelar');
      if (b) b.click();
      return true;
    })()`);
    await esperar(500);

    const shot = await enviar('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync(
        path.join(OUT_DIR, `delivery-branch-${USUARIO}.png`),
        Buffer.from(shot.data, 'base64'),
      );
    }

    console.log(
      `\nerrores de consola: ${errores.length}${errores.length ? ` → ${errores.join(' | ')}` : ''}`,
    );
    console.log(
      fallos === 0 ? '✅ verificaciones UI ok' : `❌ ${fallos} verificación(es) con problemas`,
    );
    ws.close();
    await esperar(300);
    process.exitCode = fallos === 0 && errores.length === 0 ? 0 : 1;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(USER_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
