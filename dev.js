#!/usr/bin/env node
/**
 * MercAldas — lanzador de servicios.
 *
 * Uso:
 *   node dev.js            # DEV: instala dependencias faltantes, levanta
 *                          #   PostgreSQL + los 7 servicios en segundo plano,
 *                          #   espera a que el backend esté listo, imprime las
 *                          #   URLs y termina (la terminal queda libre).
 *   node dev.js --prod     # PRODUCCIÓN ("en vivo"): comandos de producción.
 *                          #   Requiere builds previos (backend: npm run build,
 *                          #   webs: npm run build). Los logs quedan en logs/*.log.
 *   node dev.js --stop     # Detiene los servicios levantados por dev.js.
 *   node dev.js --help     # Esta ayuda.
 *
 * Logs: un archivo por servicio en logs/
 *   logs/db.log  logs/backend.log  logs/web.log  logs/admin.log  logs/analytics.log  logs/picking.log  logs/bot.log  logs/ia.log
 *
 * La BD (docker) queda corriendo al salir; se detiene con
 * `cd db/docker && docker compose stop`.
 */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const ROOT = __dirname;
const LOGS_DIR = path.join(ROOT, "logs");
const PIDS_FILE = path.join(LOGS_DIR, ".pids.json");
const DELIVERY_DIR = path.join(ROOT, "Interface movil delivery");
const DELIVERY_PORT = 8081;
const OSRM_DIR = path.join(ROOT, "delivery-routing");
const OSRM_PORT = 5000;

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes("--prod") || ARGS.includes("--live") ? "prod" : "dev";
const STOP = ARGS.includes("--stop");
const HELP = ARGS.includes("--help");

// Dependencias por servicio: `marker` es lo que se comprueba para saber si ya
// están instaladas; `install` son los comandos que las instalan si faltan.
const NPM_DEPS = {
  marker: ["node_modules"],
  markerType: "dir",
  install: [["npm", "install"]],
};

// Los fronts del ecommerce usan pnpm (pnpm-lock.yaml). Si pnpm no está
// instalado se cae a npm: los scripts dev/build/preview existen igual.
const PM = hasBin("pnpm") ? "pnpm" : "npm";
const PNPM_DEPS = {
  marker: ["node_modules"],
  markerType: "dir",
  install: [[PM, "install"]],
};
const PYTHON_DEPS = {
  marker: [".venv", "bin", "python"],
  markerType: "file",
  install: [
    ["python3", "-m", "venv", ".venv"],
    [".venv", "bin", "pip", "install", "-r", "requirements.txt"],
  ],
};

function hasBin(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

const C = {
  db: "\x1b[36m",
  backend: "\x1b[31m",
  web: "\x1b[32m",
  admin: "\x1b[34m",
  analytics: "\x1b[96m",
  picking: "\x1b[95m",
  "picking-admin": "\x1b[91m",
  "delivery-admin": "\x1b[93m",
  bot: "\x1b[35m",
  ia: "\x1b[33m",
  delivery: "\x1b[92m",
  osrm: "\x1b[90m",
  reset: "\x1b[0m",
};

const SERVICES = [
  {
    name: "backend",
    dir: "backend",
    url: "http://localhost:3000",
    dev: ["npm", "run", "dev"],
    prod: ["npm", "run", "start:prod"],
    deps: NPM_DEPS,
  },
  {
    name: "web",
    dir: "Interface web client",
    url: "http://localhost:5173",
    dev: [PM, "run", "dev"],
    prod: ["npx", "vite", "preview"],
    deps: PNPM_DEPS,
  },
  {
    name: "admin",
    dir: "Interface web admin",
    url: "http://localhost:8443",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    deps: PNPM_DEPS,
  },
  {
    name: "analytics",
    dir: "Interface web analytics",
    url: "http://localhost:8444",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    deps: PNPM_DEPS,
  },
  {
    name: "picking",
    dir: "Interface web picking",
    url: "http://localhost:8445",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    deps: PNPM_DEPS,
  },
  {
    name: "picking-admin",
    dir: "Interface web picking admin",
    url: "http://localhost:8446",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    deps: PNPM_DEPS,
  },
  {
    name: "delivery-admin",
    dir: "Interface web delivery admin",
    url: "http://localhost:8447",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    deps: PNPM_DEPS,
  },
  {
    name: "bot",
    dir: "bot",
    url: "http://localhost:8000",
    dev: ["bash", "dev.sh"],
    prod: null, // se resuelve en resolveCmd()
    deps: PYTHON_DEPS,
  },
  {
    name: "ia",
    dir: "ia-service",
    url: "http://localhost:8002",
    dev: ["bash", "dev.sh"],
    prod: null, // se resuelve en resolveCmd()
    deps: PYTHON_DEPS,
  },
];

// ── Selección por aplicativo (flags --x) ─────────────────────
// Cada app declara sus dependencias; al pedirla se levanta también lo mínimo
// para que funcione (p. ej. --analytics ⇒ backend + PostgreSQL de campañas).
const APP_ALIASES = {
  client: "web",
  web: "web",
  backend: "backend",
  admin: "admin",
  analytics: "analytics",
  ia: "ia",
  picking: "picking",
  "picking-admin": "picking-admin",
  "delivery-admin": "delivery-admin",
  bot: "bot",
  delivery: "delivery",
  osrm: "osrm",
};

const APP_DEPENDS = {
  // db-campaigns (PostgreSQL de analytics, :5436) solo lo necesita el panel
  // de analytics; el backend de ecommerce usa únicamente la BD principal (:5432).
  backend: ["db"],
  web: ["backend"],
  admin: ["backend"],
  analytics: ["backend", "db-campaigns"], // panel analytics + su BD de campañas
  picking: ["backend"],
  "picking-admin": ["backend"],
  "delivery-admin": ["backend"],
  bot: ["backend"],
  ia: ["backend"], // genera contenido vía el backend; no usa la BD de campañas
  delivery: ["backend", "osrm"], // API real: backend (+BD) + OSRM para rutas
  osrm: [],
};

const NO_SELECTOR_FLAGS = new Set(["--prod", "--live", "--stop", "--help", "--all"]);

/** null ⇒ levantar todo (comportamiento por defecto). */
function resolveSelection() {
  const requested = ARGS.filter((a) => a.startsWith("--") && !NO_SELECTOR_FLAGS.has(a))
    .map((a) => a.slice(2).toLowerCase());
  if (requested.length === 0) return null;
  const names = requested.map((r) => APP_ALIASES[r]).filter((n) => n !== undefined);
  if (names.length === 0) return null;

  const out = [];
  const seen = new Set();
  const add = (n) => {
    for (const dep of APP_DEPENDS[n] ?? []) {
      if (dep === "db" || dep === "db-campaigns" || dep === "osrm") {
        if (!seen.has(dep)) {
          seen.add(dep);
          out.push(dep);
        }
      } else {
        add(dep);
      }
    }
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  };
  for (const n of names) add(n);
  return out; // orden de arranque: dependencias primero
}

function selectionLabel(plan) {
  if (!plan) return "todo";
  const apps = plan.filter((n) => n !== "db" && n !== "db-campaigns" && n !== "osrm");
  return apps.length ? apps.join(" + ") : "solo bases de datos";
}

// ── Utilidades de red ───────────────────────────────────────

function waitForPort(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect({ host: "127.0.0.1", port });
      const done = (ok) => {
        try {
          sock.destroy();
        } catch {
          /* noop */
        }
        resolve(ok);
      };
      sock.once("connect", () => done(true));
      sock.once("error", () => {
        try {
          sock.destroy();
        } catch {
          /* noop */
        }
        if (Date.now() > deadline) done(false);
        else setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/** Mata el proceso que escuche en `port` (Unix: fuser, Windows: netstat+taskkill). */
function killPort(port) {
  if (process.platform === "win32") {
    try {
      const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout;
      const pids = new Set();
      out.split("\n").forEach((line) => {
        const m = line.trim().match(new RegExp(`:${port}\\s+.*?LISTENING\\s+(\\d+)\\s*$`));
        if (m) pids.add(m[1]);
      });
      pids.forEach((pid) => {
        try {
          spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
        } catch {
          /* ya terminó */
        }
      });
      if (pids.size)
        console.log(`  ✓ puerto ${port} liberado (PID ${[...pids].join(", ")})`);
    } catch {
      /* sin procesos */
    }
  } else {
    const r = spawnSync("fuser", ["-k", `${port}/tcp`], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    const out = (r.stdout || "").toString().trim();
    if (out) console.log(`  ✓ puerto ${port} liberado (PID ${out})`);
  }
}

// ── Logs ────────────────────────────────────────────────────

function openLog(name) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = path.join(LOGS_DIR, `${name}.log`);
  const fd = fs.openSync(logPath, "a");
  fs.writeSync(
    fd,
    `\n===== [${name}] ${new Date().toISOString()} modo=${MODE} =====\n`,
  );
  return { fd, logPath };
}

// ── Base de datos (Docker) ──────────────────────────────────

function startDatabase() {
  const dbDir = path.join(ROOT, "db", "docker");
  console.log(`${C.db}[db]${C.reset} 🐘 PostgreSQL (docker compose up -d) → logs/db.log`);

  const { fd } = openLog("db");
  const run = (args) =>
    spawnSync("docker", args, {
      cwd: dbDir,
      stdio: ["ignore", fd, fd],
      timeout: 120000,
    });

  // Intento con --wait (espera el healthcheck de pg_isready); si no lo soporta,
  // cae al arranque simple.
  let r = run(["compose", "up", "-d", "--wait"]);
  if (r.status === 0) {
    fs.closeSync(fd);
    console.log(`${C.db}[db]${C.reset} ✅ PostgreSQL listo`);
    return true;
  }
  r = run(["compose", "up", "-d"]);
  fs.closeSync(fd);
  if (r.status === 0) {
    console.log(`${C.db}[db]${C.reset} ✅ Contenedor arrancado. Esperando :5432...`);
    return true;
  }
  console.warn(
    `${C.db}[db]${C.reset} ⚠️  No se pudo levantar PostgreSQL (detalle en logs/db.log).`,
  );
  console.warn(
    `${C.db}[db]${C.reset} 💡 Docker no está disponible: arranca el daemon (sudo systemctl start docker o sudo service docker start) y, si hace falta, añade tu usuario al grupo docker (sudo usermod -aG docker $USER) y reinicia sesión.`,
  );
  return false;
}

/** PostgreSQL de ANALYTICS (campañas/segmentación, :5436) — db-campaigns/. */
function startDatabaseCampaigns() {
  const dbDir = path.join(ROOT, "db-campaigns");
  console.log(`${C.db}[db-campaigns]${C.reset} 🗄️  PostgreSQL analytics (docker compose up -d) → logs/db.log`);

  const { fd } = openLog("db");
  const run = (args) =>
    spawnSync("docker", args, {
      cwd: dbDir,
      stdio: ["ignore", fd, fd],
      timeout: 120000,
    });

  let r = run(["compose", "up", "-d", "--wait"]);
  if (r.status === 0) {
    fs.closeSync(fd);
    console.log(`${C.db}[db-campaigns]${C.reset} ✅ PostgreSQL analytics listo (:5436)`);
    return true;
  }
  r = run(["compose", "up", "-d"]);
  fs.closeSync(fd);
  if (r.status === 0) {
    console.log(`${C.db}[db-campaigns]${C.reset} ✅ Contenedor arrancado. Esperando :5436...`);
    return true;
  }
  console.warn(
    `${C.db}[db-campaigns]${C.reset} ⚠️  No se pudo levantar PostgreSQL analytics (detalle en logs/db.log).`,
  );
  console.warn(
    `${C.db}[db-campaigns]${C.reset} 💡 Docker no está disponible: arranca el daemon (sudo systemctl start docker o sudo service docker start) y, si hace falta, añade tu usuario al grupo docker (sudo usermod -aG docker $USER) y reinicia sesión.`,
  );
  return false;
}

// ── Dependencias ───────────────────────────────────────────

/** Motor de rutas OSRM (delivery, :5000) — delivery-routing/. */
function startOsrm() {
  console.log(`${C.osrm}[osrm]${C.reset} 🗺️  OSRM Manizales (docker compose up -d) → logs/db.log`);

  const { fd } = openLog("db");
  const run = (args) =>
    spawnSync("docker", args, {
      cwd: OSRM_DIR,
      stdio: ["ignore", fd, fd],
      timeout: 120000,
    });

  const r = run(["compose", "up", "-d"]);
  fs.closeSync(fd);
  if (r.status === 0) {
    console.log(`${C.osrm}[osrm]${C.reset} ✅ Contenedor arrancado. Esperando :${OSRM_PORT}...`);
    return true;
  }
  console.warn(
    `${C.osrm}[osrm]${C.reset} ⚠️  No se pudo levantar OSRM (detalle en logs/db.log).`,
  );
  console.warn(
    `${C.osrm}[osrm]${C.reset} 💡 Si aún no has preparado el grafo: cd delivery-routing && ./prepare.sh`,
  );
  return false;
}

// ── Dependencias ───────────────────────────────────────────

function dirHasContent(p) {
  try {
    return fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

/** Instala las dependencias de un servicio si no están (node_modules/.venv). */
function ensureDeps(svc) {
  const color = C[svc.name] || "";
  const cwd = path.join(ROOT, svc.dir);
  const markerPath = path.join(cwd, ...svc.deps.marker);
  const installed =
    svc.deps.markerType === "file"
      ? fs.existsSync(markerPath)
      : dirHasContent(markerPath);
  if (installed) return true;

  console.log(`${color}[${svc.name}]${C.reset} 📦 instalando dependencias...`);
  for (const step of svc.deps.install) {
    const r = spawnSync(step[0], step.slice(1), { cwd, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(
        `${color}[${svc.name}]${C.reset} ✘ falló la instalación: ${step.join(" ")} — se omite este servicio`,
      );
      return false;
    }
  }
  console.log(`${color}[${svc.name}]${C.reset} ✅ dependencias listas`);
  return true;
}

// ── Arranque de servicios ───────────────────────────────────

function resolveCmd(svc) {
  if (svc.name === "bot" && MODE === "prod") {
    const py = path.join(ROOT, "bot", ".venv", "bin", "python");
    if (!fs.existsSync(py)) {
      console.warn(
        `${C.bot}[bot]${C.reset} ⚠️  bot/.venv no existe — crealo con: ` +
          `python3 -m venv bot/.venv && bot/.venv/bin/pip install -r bot/requirements.txt`,
      );
      return null;
    }
    // Producción: uvicorn sin --reload
    return [py, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"];
  }
  if (svc.name === "ia" && MODE === "prod") {
    const py = path.join(ROOT, "ia-service", ".venv", "bin", "python");
    if (!fs.existsSync(py)) {
      console.warn(
        `${C.ia}[ia]${C.reset} ⚠️  ia-service/.venv no existe — crealo con: ` +
          `python3 -m venv ia-service/.venv && ia-service/.venv/bin/pip install -r ia-service/requirements.txt`,
      );
      return null;
    }
    // Producción: uvicorn sin --reload
    return [py, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"];
  }
  return MODE === "prod" ? svc.prod : svc.dev;
}

function startService(svc) {
  const color = C[svc.name] || "";
  console.log(`${color}[${svc.name}]${C.reset} ▶ ${svc.url || svc.dir}  (log: logs/${svc.name}.log)`);

  const cmd = resolveCmd(svc);
  if (!cmd) return null;

  const port = svc.url ? new URL(svc.url).port : null;
  if (port) {
    killPort(port);
    sleepSync(800); // tiempo para que el SO libere el socket
  }

  const { fd } = openLog(svc.name);
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: path.join(ROOT, svc.dir),
    stdio: ["ignore", fd, fd],
    detached: true, // su propio grupo de procesos: sobrevive a la terminal
    shell: process.platform === "win32",
  });

  child.on("error", (err) => {
    console.error(`${color}[${svc.name}]${C.reset} ✘ no se pudo arrancar: ${err.message}`);
  });
  child.unref(); // no mantener vivo al padre por el hijo
  fs.closeSync(fd); // el hijo heredó su propio fd al archivo
  return child.pid;
}

function printUrls(services, showDb, showCampaigns, showOsrm) {
  console.log("\n━━━━━━━━━━━━━ MercAldas — URLs ━━━━━━━━━━━━━");
  for (const svc of services) {
    if (!svc.url) continue;
    console.log(`  ${svc.name.toUpperCase().padEnd(8)} → ${svc.url}`);
  }
  if (showDb) console.log("  DB             → PostgreSQL localhost:5432 (docker)");
  if (showCampaigns) console.log("  DB-CAMPAIGNS   → PostgreSQL localhost:5436 (docker, analytics)");
  if (showOsrm) console.log("  OSRM           → Rutas http://localhost:5000 (docker, Manizales)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const started = services.map((s) => s.name).join(", ");
  console.log(`Logs: logs/*.log  (${started || "sin servicios"}). El DELIVERY imprime en esta terminal.`);
}

// ── Delivery app (Expo Go) ────────────────────────────────────

function ensureDeliveryDeps() {
  if (dirHasContent(path.join(DELIVERY_DIR, "node_modules"))) return true;
  console.log(
    `${C.delivery}[delivery]${C.reset} 📦 instalando dependencias (${PM})...`,
  );
  const r = spawnSync(PM, ["install"], {
    cwd: DELIVERY_DIR,
    stdio: "inherit",
    timeout: 300000,
  });
  if (r.status !== 0) {
    console.error(
      `${C.delivery}[delivery]${C.reset} ✘ falló la instalación de dependencias`,
    );
    return false;
  }
  return true;
}

/**
 * Arranca la delivery app con Expo en FOREGROUND (interactivo): así el QR de
 * Expo Go aparece en esta terminal. Ctrl+C detiene solo el delivery; el resto
 * de servicios sigue en background. Solo aplica en modo dev.
 */
function startDeliveryExpo() {
  if (!ensureDeliveryDeps()) return;

  console.log("");
  console.log(
    `${C.delivery}📱 DELIVERY APP${C.reset} — escanea el QR con **Expo Go** (celular en la MISMA red Wi-Fi).`,
  );
  console.log(
    `${C.delivery}[delivery]${C.reset}   Sin EXPO_PUBLIC_API_URL corre en modo mock (demo / demo1234).`,
  );
  console.log(
    `${C.delivery}[delivery]${C.reset}   Ctrl+C aquí detiene SOLO el delivery; lo demás sigue en background.`,
  );
  console.log("");

  const r = spawnSync(PM, ["exec", "expo", "start"], {
    cwd: DELIVERY_DIR,
    stdio: "inherit",
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
  });
  if (r.status !== 0) {
    console.warn(
      `${C.delivery}[delivery]${C.reset} ⚠️  expo terminó con código ${r.status ?? "?"} — ¿puerto ${DELIVERY_PORT} ocupado? (node dev.js --stop para liberar)`,
    );
  }
}

// ── Detención ───────────────────────────────────────────────

function stopAll() {
  let pids = {};
  try {
    pids = JSON.parse(fs.readFileSync(PIDS_FILE, "utf8"));
  } catch {
    /* sin archivo de pids */
  }

  const entries = Object.entries(pids);
  if (!entries.length) console.log("No hay servicios registrados (logs/.pids.json).");
  for (const [name, pid] of entries) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
      } else {
        process.kill(-pid, "SIGTERM"); // todo el grupo (procesos desacoplados)
      }
      console.log(`⏹  ${name} (pid ${pid})`);
    } catch {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`⏹  ${name} (pid ${pid})`);
      } catch {
        console.log(`  ${name} ya no estaba corriendo`);
      }
    }
  }

  // Red de seguridad: liberar los puertos de los servicios
  for (const svc of SERVICES) {
    if (svc.url) killPort(new URL(svc.url).port);
  }
  killPort(DELIVERY_PORT); // expo/delivery (no queda registrado en pids)

  // OSRM corre como contenedor (no como proceso node): se detiene aparte.
  spawnSync("docker", ["compose", "stop"], { cwd: OSRM_DIR, stdio: "ignore" });

  try {
    fs.unlinkSync(PIDS_FILE);
  } catch {
    /* noop */
  }
  console.log("\n💡 La BD (docker) sigue corriendo. Para detenerla: cd db/docker && docker compose stop");
  console.log("   La BD de analytics (campañas): cd db-campaigns && docker compose stop");
  console.log("   OSRM (rutas): cd delivery-routing && docker compose stop");
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  if (HELP) {
    console.log(
      "MercAldas launcher\n" +
        "  node dev.js                    → todo (dev; termina con el QR del DELIVERY app)\n" +
        "  node dev.js --client           → solo web client + sus dependencias\n" +
        "  node dev.js --analytics        → solo analytics + backend + BDs (incl. db-campaigns)\n" +
        "  node dev.js --delivery         → QR delivery + backend + OSRM (API real)\n" +
        "  node dev.js --osrm             → solo el motor de rutas OSRM (Manizales)\n" +
        "  node dev.js --admin --picking  → combina aplicativos\n" +
        "  Flags: --backend --client --admin --analytics --picking --picking-admin --bot --ia --delivery --osrm --all\n" +
        "  node dev.js --prod [flags]     → producción (requiere builds previos)\n" +
        "  node dev.js --stop             → detiene los servicios\n" +
        "  node dev.js --help             → esta ayuda\n" +
        "  cd db/docker && docker compose stop → detener PostgreSQL\n" +
        "  cd db-campaigns && docker compose stop → detener PostgreSQL analytics (:5436)\n" +
        "  cd delivery-routing && docker compose stop → detener OSRM (rutas)\n",
    );
    return;
  }
  if (STOP) return stopAll();

  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const plan = resolveSelection(); // null ⇒ todo
  const wantDb = plan === null || plan.includes("db");
  const wantCampaigns = plan === null || plan.includes("db-campaigns");
  const wantOsrm = plan === null || plan.includes("osrm");
  const svcNames =
    plan === null
      ? SERVICES.map((s) => s.name)
      : plan.filter((n) => n !== "db" && n !== "db-campaigns" && n !== "osrm");
  const services = SERVICES.filter((s) => svcNames.includes(s.name));
  const wantDelivery = plan === null || plan.includes("delivery");

  console.log(
    `🧪 MercAldas — modo ${MODE.toUpperCase()} · selección: ${selectionLabel(plan)}  (logs → logs/*.log)`,
  );
  if (PM === "npm")
    console.warn(
      `${C.picking}[pnpm]${C.reset} ⚠️  pnpm no está instalado — se usará npm como gestor de paquetes en los fronts.`,
    );
  console.log("");

  // 1. Instalar dependencias faltantes de los servicios elegidos.
  const sinDeps = new Set();
  for (const svc of services) {
    if (!ensureDeps(svc)) sinDeps.add(svc.name);
  }
  console.log("");

  if (wantDb) {
    startDatabase();
    const dbUp = await waitForPort(5432, 90000);
    if (!dbUp)
      console.warn(
        `${C.db}[db]${C.reset} ⚠️  PostgreSQL no responde en :5432; los servicios reintentarán al conectar.`,
      );
  }
  if (wantCampaigns) {
    startDatabaseCampaigns();
    const dbCampaignsUp = await waitForPort(5436, 90000);
    if (!dbCampaignsUp)
      console.warn(
        `${C.db}[db-campaigns]${C.reset} ⚠️  PostgreSQL analytics no responde en :5436; la segmentación fallará hasta que esté arriba.`,
      );
  }
  if (!wantDb && !wantCampaigns)
    console.log(`${C.db}[db]${C.reset} 🚫 PostgreSQL no iniciado (esta selección no lo necesita).`);

  if (wantOsrm) {
    startOsrm();
    const osrmUp = await waitForPort(OSRM_PORT, 90000);
    if (!osrmUp)
      console.warn(
        `${C.osrm}[osrm]${C.reset} ⚠️  OSRM no responde en :${OSRM_PORT} — ¿corriste delivery-routing/prepare.sh?`,
      );
  }

  const pids = {};
  for (const svc of services) {
    if (sinDeps.has(svc.name)) continue; // falló la instalación de dependencias
    const pid = startService(svc);
    if (pid) pids[svc.name] = pid;
  }
  if (Object.keys(pids).length) {
    fs.writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2));
  } else {
    try {
      fs.unlinkSync(PIDS_FILE);
    } catch {
      /* noop */
    }
  }

  // No liberar la terminal hasta que el backend esté montado: si se cierra
  // antes, el usuario no puede ver si arrancó bien o falló al revisar logs.
  const backendSvc = services.find((s) => s.name === "backend");
  if (backendSvc && backendSvc.url) {
    const backendPort = Number(new URL(backendSvc.url).port);
    console.log(
      `${C.backend}[backend]${C.reset} ⏳ esperando a que esté listo (${backendSvc.url})...`,
    );
    const backendUp = await waitForPort(backendPort, 120000);
    if (backendUp) {
      console.log(`${C.backend}[backend]${C.reset} ✅ Backend listo`);
    } else {
      console.warn(
        `${C.backend}[backend]${C.reset} ⚠️  No respondió en :${backendPort} — revisa logs/backend.log`,
      );
    }
  }

  printUrls(services, wantDb, wantCampaigns, wantOsrm);

  if (MODE === "dev") {
    if (wantDelivery) {
      console.log(
        "\n✅ Servicios levantados (background). Ahora el delivery app:",
      );
      startDeliveryExpo(); // bloquea mostrando el QR hasta Ctrl+C
      console.log(
        "\n⏹ Delivery detenido. El resto de servicios sigue corriendo.",
      );
    } else {
      console.log(
        "\n✅ Listo — esta selección no incluye el delivery (agrega --delivery). Terminal libre.",
      );
    }
  } else {
    console.log("\n✅ Todo levantado. Terminal libre.");
    if (wantDelivery)
      console.log(
        "   Delivery en --prod: corre desde el APK/dev build (carpeta android/), no usa Expo Go.",
      );
  }

  console.log("");
  console.log("Comandos útiles:");
  console.log(`  node dev.js --stop                  → detener los servicios levantados`);
  console.log(`  node dev.js --prod                  → levantar en modo producción`);
  console.log(`  node dev.js --help                  → mostrar ayuda`);
  console.log(`  cd db/docker && docker compose stop → detener PostgreSQL (docker)`);
  process.exit(0); // cierra el script; los servicios siguen en segundo plano
}

main();
