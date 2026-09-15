/**
 * Mide la disposición real del header del cliente en viewport móvil y de
 * escritorio, usando Chromium headless vía CDP (sin dependencias).
 *
 * Sirve para verificar cambios de responsive con números en vez de capturas:
 * a qué altura queda cada elemento, si dos logos comparten fila, si algo se
 * solapa con el buscador, etc.
 *
 * Uso: node scripts-agent/measure-web-header.mjs [url]
 */
import { spawn } from "node:child_process";

const URL_ = process.argv[2] || "http://127.0.0.1:4173/";
const PORT = 9333;
const CHROMIUM = "/usr/bin/chromium";

/** Viewport que ve el APK: 720x1604 físicos a densidad 320 → 360x802 CSS. */
const VIEWPORTS = [
  { label: "móvil 360x802 (viewport del APK)", width: 360, height: 802 },
  { label: "escritorio 1280x900", width: 1280, height: 900 },
];

const browser = spawn(
  CHROMIUM,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--user-data-dir=/tmp/chrome-measure",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore"] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a que el endpoint de CDP esté listo. */
async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* todavía no*/
    }
    await sleep(250);
  }
  throw new Error("CDP no respondió");
}

/** Cliente CDP mínimo sobre el WebSocket nativo de Node. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  return { send, close: () => ws.close() };
}

/** Expresión que corre en la página y devuelve las medidas del header. */
const MEASURE = `(() => {
  const header = document.querySelector("header");
  if (!header) return { error: "no hay <header>" };

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      right: Math.round(r.right),
      w: Math.round(r.width),
      h: Math.round(r.height),
      cy: Math.round(r.top + r.height / 2),
      display: cs.display,
      visible: cs.display !== "none" && r.width > 0 && r.height > 0,
    };
  };

  const buttons = [...header.querySelectorAll("button")];
  const anchors = [...header.querySelectorAll("a")];

  const strip = header.firstElementChild;
  const stripImgs = strip ? [...strip.querySelectorAll("img, div")].filter(
    (el) => el.tagName === "IMG" || el.className.includes("rounded-lg")
  ) : [];
  const deskLogo = anchors.find((a) => a.className.includes("md:flex"));
  const cartBtn = buttons.find(
    (b) => b.querySelector("svg") && b.textContent.includes("Carrito")
  );
  const loginBtn = buttons.find((b) =>
    ["Iniciar sesión", "Mi cuenta"].includes(b.getAttribute("aria-label") || "")
  );
  const searchInput = header.querySelector("input");

  const imgs = stripImgs.map(rect);
  return {
    viewportW: window.innerWidth,
    header: rect(header),
    strip: rect(strip),
    stripLogos: imgs,
    logosEnUnaFila:
      imgs.length >= 2 && imgs.every((r) => Math.abs(r.cy - imgs[0].cy) <= 2),
    desktopLogo: rect(deskLogo),
    searchInput: rect(searchInput),
    cartBtn: rect(cartBtn),
    loginBtn: rect(loginBtn),
    solapeBusquedaConLogos:
      imgs.length > 0 && rect(searchInput) && imgs[0].visible
        ? rect(searchInput).top < imgs[0].bottom
        : false,
    ordenFinal: [...header.children[1].children]
      .filter((el) => getComputedStyle(el).display !== "none")
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .map((el) => {
        const t = el.textContent.trim().replace(/\\s+/g, " ").slice(0, 14);
        return el.getAttribute("aria-label") || t || el.tagName.toLowerCase();
      }),
  };
})()`;

/** Imprime un resumen compacto y legible de las medidas. */
function report(m) {
  const fmt = (r) =>
    r && r.visible
      ? `x ${r.left}..${r.right}  y ${r.top}..${r.bottom}  (${r.w}x${r.h})`
      : "oculto";
  console.log(`viewport         : ${m.viewportW}px`);
  console.log(`header           : 0..${m.header.bottom} (alto ${m.header.h})`);
  console.log(`tira de logos    : ${fmt(m.strip)}`);
  (m.stripLogos || []).forEach((r, i) =>
    console.log(`  logo ${i + 1}         : ${fmt(r)}`),
  );
  console.log(`  ¿misma fila?   : ${m.logosEnUnaFila}`);
  console.log(`logo escritorio  : ${fmt(m.desktopLogo)}`);
  console.log(`buscador         : ${fmt(m.searchInput)}`);
  console.log(`carrito          : ${fmt(m.cartBtn)}`);
  console.log(`iniciar sesión   : ${fmt(m.loginBtn)}`);
  console.log(`solape logos/búsq: ${m.solapeBusquedaConLogos}`);
  console.log(`filas del header : ${m.ordenFinal.join(" | ")}`);
}

/** Enfoca el buscador y mide su desplegable (se ancla con `--header-h`). */
const OPEN_SEARCH = `(async () => {
  const header = document.querySelector("header");
  const dd = [...header.querySelectorAll("div")].find(
    (d) => typeof d.className === "string" && d.className.includes("top-[var(--header-h)]")
  );
  if (!dd) return { abierto: false, motivo: "desplegable no renderizado" };
  const r = dd.getBoundingClientRect();
  const h = header.getBoundingClientRect();
  return {
    abierto: true,
    headerAlto: Math.round(h.height),
    headerBottom: Math.round(h.bottom),
    varCss: getComputedStyle(header).getPropertyValue("--header-h").trim(),
    desplegable: {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      right: Math.round(r.right),
    },
    empalmaConHeader: Math.abs(Math.round(r.top) - Math.round(h.bottom)) <= 2,
  };
})()`;

async function main() {
  await waitForCdp();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const cdp = await connect(page.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 802,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send("Page.navigate", { url: URL_ });
  await sleep(6000); // deja cargar la SPA y sus datos

  for (const vp of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 768,
    });
    await sleep(1200);
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: MEASURE,
      returnByValue: true,
    });
    console.log(`\n═══ ${vp.label} ═══`);
    report(result.value);

    const { result: box } = await cdp.send("Runtime.evaluate", {
      expression:
        '(() => { const i = document.querySelector("header input"); if (!i) return null; const r = i.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()',
      returnByValue: true,
    });
    let ddReport = { abierto: false, motivo: "sin input" };
    if (box.value) {
      // Clic real: el foco programático no siempre dispara onFocus en headless.
      for (const type of ["mousePressed", "mouseReleased"]) {
        await cdp.send("Input.dispatchMouseEvent", {
          type,
          x: box.value.x,
          y: box.value.y,
          button: "left",
          clickCount: 1,
        });
      }
      await sleep(600);
      const { result: dd } = await cdp.send("Runtime.evaluate", {
        expression: OPEN_SEARCH,
        returnByValue: true,
        awaitPromise: true,
      });
      ddReport = dd.value;
    }
    console.log(`desplegable búsq.: ${JSON.stringify(ddReport)}`);
  }

  cdp.close();
  browser.kill();
}

main().catch((e) => {
  console.error(e);
  browser.kill();
  process.exit(1);
});
