#!/usr/bin/env node
/**
 * prod.js — despliegue de PRODUCCIÓN de Mercaldas (bare-metal, sin contenedores
 * de aplicación; solo las bases de datos y OSRM corren en Docker).
 *
 * Es la contraparte de `dev.js` para producción:
 *   - compila los artefactos (backend NestJS + los 5 fronts Vite) con `--build`
 *   - sirve los fronts ya compilados con `vite preview` (estático, no dev server)
 *   - levanta backend y bot en modo producción
 *   - mantiene la base de datos (5432) y OSRM (5000) vía Docker
 *
 * NO arranca las apps móviles (Expo): en producción se compilan a APK/IPA y
 * apuntan al backend por `EXPO_PUBLIC_API_URL`; aquí no se sirve un dev server.
 *
 * El siguiente paso para exponerlo con dominios (HTTPS) es un Caddy por delante
 * que rutee cada dominio → estos puertos internos; eso se monta aparte.
 *
 * Configuración: `prod.config.json` (o el que pases con --config) define los
 * dominios/IP. prod.js deriva de ahí `VITE_API_URL` (build de los fronts) y
 * `CORS_ORIGIN` (backend), y al terminar imprime los registros DNS a crear.
 *
 * Uso rápido:
 *   node prod.js --init-config     → crea prod.config.json (plantilla)
 *   node prod.js --dns             → imprime los registros DNS a configurar
 *   node prod.js --build           → compila TODO y levanta
 *   node prod.js                   → levanta TODO (usa los dist ya existentes)
 *   node prod.js --web --backend   → solo cliente web + API (+ sus dependencias)
 *   node prod.js --stop            → detiene los servicios de prod.js
 *   node prod.js --help            → ayuda
 */

const cp = require("child_process");
// `windowsHide` oculta la consola de los hijos en Windows (en otros SO se
// ignora), pero NO basta junto a `detached`: ese flag implica DETACHED_PROCESS y
// Windows ignora CREATE_NO_WINDOW, asignando al hijo su PROPIA consola → aparece
// una ventana de cmd por servicio. Por eso en Windows NO se usa `detached`.
const spawn = (cmd, args, opts = {}) => cp.spawn(cmd, args, { windowsHide: true, ...opts });
const spawnSync = (cmd, args, opts = {}) => cp.spawnSync(cmd, args, { windowsHide: true, ...opts });
// POSIX: detached ⇒ grupo propio, para matarlo entero con `kill -pid`.
// Windows: sin detached el hijo queda SIN consola (ni ventana) y aun así
// sobrevive al cierre de la terminal; `--stop` lo mata con taskkill /T por PID.
const DETACHED = process.platform !== "win32";
const fs = require("fs");
const net = require("net");
const path = require("path");

const ROOT = __dirname;
const LOGS_DIR = path.join(ROOT, "logs");
const PIDS_FILE = path.join(LOGS_DIR, ".pids.prod.json");
const OSRM_DIR = path.join(ROOT, "delivery-routing");
const OSRM_PORT = 5000;

const ARGS = process.argv.slice(2);
const STOP = ARGS.includes("--stop");
const HELP = ARGS.includes("--help");
const BUILD = ARGS.includes("--build");
const NO_BUILD = ARGS.includes("--no-build");
const DNS_ONLY = ARGS.includes("--dns");
const INIT_CONFIG = ARGS.includes("--init-config");
const WRITE_CADDY = ARGS.includes("--write-caddy");
const CONFIG_IDX = ARGS.indexOf("--config");
const CONFIG_PATH =
  CONFIG_IDX >= 0 && ARGS[CONFIG_IDX + 1]
    ? path.resolve(ROOT, ARGS[CONFIG_IDX + 1])
    : path.join(ROOT, "prod.config.json");

// ── Gestor de paquetes ──────────────────────────────────────
// Los fronts del ecommerce usan pnpm (pnpm-lock.yaml). Si no está instalado,
// se cae a npm: los scripts build/preview existen igual.
function hasBin(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return r.status === 0;
}
const PM = hasBin("pnpm") ? "pnpm" : "npm";

// Dependencias por servicio (mismo criterio que dev.js).
const NPM_DEPS = {
  marker: ["node_modules"],
  markerType: "dir",
  install: [["npm", "install"]],
};
const PNPM_DEPS = {
  marker: ["node_modules"],
  markerType: "dir",
  install: [[PM, "install"]],
};
// ── Python (bot) ────────────────────────────────────────────
// En Windows `python3` no existe (alias de la Microsoft Store) y el venv usa
// Scripts\ en vez de bin/; se prueba python3 → python → py -3.
const PY_VENV_BIN =
  process.platform === "win32"
    ? [".venv", "Scripts", "python.exe"]
    : [".venv", "bin", "python"];
const PY_VENV_PY = PY_VENV_BIN.join(path.sep);

/** Candidatos a intérprete: PATH primero, luego ubicaciones típicas de Windows. */
function pythonCandidates() {
  const list = [["python3"], ["python"], ["py", "-3"]];
  if (process.platform === "win32") {
    for (const root of [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python"),
      path.join(process.env.ProgramFiles || "", "Python"),
    ]) {
      try {
        for (const dir of fs.readdirSync(root)) {
          if (/^Python3/.test(dir)) list.push([path.join(root, dir, "python.exe")]);
        }
      } catch {
        /* carpeta inexistente */
      }
    }
  }
  return list;
}

function findPython() {
  for (const cmd of pythonCandidates()) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), "--version"], { stdio: "ignore" });
    if (r.status === 0) return cmd;
  }
  return null;
}

const PY_BASE = findPython();
const PYTHON_DEPS = {
  marker: PY_VENV_BIN,
  markerType: "file",
  // null ⇒ no hay Python instalado; `ensureDeps` lo reporta y omite el servicio.
  install: PY_BASE
    ? [
        [...PY_BASE, "-m", "venv", ".venv"],
        [PY_VENV_PY, "-m", "pip", "install", "-r", "requirements.txt"],
      ]
    : null,
};

// Colores de terminal (igual que dev.js).
const C = {
  db: "\x1b[36m",
  backend: "\x1b[31m",
  web: "\x1b[32m",
  admin: "\x1b[34m",
  picking: "\x1b[95m",
  "picking-admin": "\x1b[91m",
  "delivery-admin": "\x1b[93m",
  bot: "\x1b[35m",
  reset: "\x1b[0m",
};

// Binario local de un paquete instalado (vite / tsc), sin depender de npx.
function localBin(dir, name) {
  const bin = path.join(dir, "node_modules", ".bin", name);
  return process.platform === "win32" ? bin + ".cmd" : bin;
}

/**
 * Servicios de producción.
 * - `url`  → puerto interno en el que escucha (killPort + printUrls + waitForPort).
 * - `build`→ pasos de compilación (vacío/omitido = no compila, p. ej. Python).
 * - El comando de ejecución se resuelve en `resolveCmd()` (puertos fijos, no `vite preview` por defecto).
 */
const SERVICES = [
  {
    name: "backend",
    dir: "backend",
    url: "http://localhost:3000",
    deps: NPM_DEPS,
  },
  {
    name: "web",
    dir: "Interface web client",
    url: "http://localhost:5173",
    build: [[PM, "run", "build"]],
    deps: PNPM_DEPS,
  },
  {
    name: "admin",
    dir: "Interface web admin",
    url: "http://localhost:8443",
    build: [[PM, "run", "build"]],
    deps: PNPM_DEPS,
  },
  {
    name: "picking",
    dir: "Interface web picking",
    url: "http://localhost:8445",
    build: [[PM, "run", "build"]],
    deps: PNPM_DEPS,
  },
  {
    name: "picking-admin",
    dir: "Interface web picking admin",
    url: "http://localhost:8446",
    build: [[PM, "run", "build"]],
    deps: PNPM_DEPS,
  },
  {
    name: "delivery-admin",
    dir: "Interface web delivery admin",
    url: "http://localhost:8447",
    build: [[PM, "run", "build"]],
    deps: PNPM_DEPS,
  },
  {
    name: "bot",
    dir: "bot",
    url: "http://localhost:8000",
    deps: PYTHON_DEPS,
  },
];

const APP_ALIASES = {
  client: "web",
  web: "web",
  backend: "backend",
  admin: "admin",
  picking: "picking",
  "picking-admin": "picking-admin",
  "delivery-admin": "delivery-admin",
  bot: "bot",
  osrm: "osrm",
};

const APP_DEPENDS = {
  backend: ["db"],
  web: ["backend"],
  admin: ["backend"],
  picking: ["backend"],
  "picking-admin": ["backend"],
  "delivery-admin": ["backend"],
  bot: ["backend"],
  osrm: [],
};

const NO_SELECTOR_FLAGS = new Set([
  "--stop",
  "--help",
  "--build",
  "--no-build",
  "--all",
  "--dns",
  "--init-config",
  "--config",
  "--write-caddy",
]);

/** Flags `--x` no reconocidos. Si hay alguno, el launcher no ejecuta nada. */
function unknownFlags() {
  const valid = new Set(
    [...NO_SELECTOR_FLAGS, ...Object.keys(APP_ALIASES).map((k) => `--${k}`)].map((f) =>
      f.toLowerCase(),
    ),
  );
  return ARGS.filter((a) => a.startsWith("--") && !valid.has(a.toLowerCase()));
}

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
      if (dep === "db" || dep === "osrm") {
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
  const apps = plan.filter((n) => n !== "db" && n !== "osrm");
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
  const logPath = path.join(LOGS_DIR, `${name}.prod.log`);
  const fd = fs.openSync(logPath, "a");
  fs.writeSync(fd, `\n===== [${name}] ${new Date().toISOString()} modo=prod =====\n`);
  return { fd, logPath };
}

// ── Bases de datos (Docker) ─────────────────────────────────

function startDatabase() {
  const dbDir = path.join(ROOT, "db", "docker");
  console.log(`${C.db}[db]${C.reset} 🐘 PostgreSQL (docker compose up -d) → logs/db.prod.log`);
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
    console.log(`${C.db}[db]${C.reset} ✅ PostgreSQL listo`);
    return true;
  }
  r = run(["compose", "up", "-d"]);
  fs.closeSync(fd);
  if (r.status === 0) {
    console.log(`${C.db}[db]${C.reset} ✅ Contenedor arrancado. Esperando :5432...`);
    return true;
  }
  console.warn(`${C.db}[db]${C.reset} ⚠️  No se pudo levantar PostgreSQL (logs/db.prod.log).`);
  console.warn(
    `${C.db}[db]${C.reset} 💡 Arranca Docker: sudo systemctl start docker (y añade tu usuario: sudo usermod -aG docker $USER).`,
  );
  return false;
}

function startOsrm() {
  console.log(`${C.osrm}[osrm]${C.reset} 🗺️  OSRM Manizales (docker compose up -d) → logs/db.prod.log`);
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
  console.warn(`${C.osrm}[osrm]${C.reset} ⚠️  No se pudo levantar OSRM (logs/db.prod.log).`);
  console.warn(`${C.osrm}[osrm]${C.reset} 💡 Si aún no has preparado el grafo: cd delivery-routing && ./prepare.sh`);
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

function ensureDeps(svc) {
  const color = C[svc.name] || "";
  const cwd = path.join(ROOT, svc.dir);
  const markerPath = path.join(cwd, ...svc.deps.marker);
  const installed =
    svc.deps.markerType === "file" ? fs.existsSync(markerPath) : dirHasContent(markerPath);
  if (installed) return true;

  console.log(`${color}[${svc.name}]${C.reset} 📦 instalando dependencias...`);
  if (!svc.deps.install) {
    console.error(
      `${color}[${svc.name}]${C.reset} ✘ no se encontró Python (python3/python/py); instálalo y reintenta — se omite este servicio`,
    );
    return false;
  }
  for (const raw of svc.deps.install) {
    // En Windows un ejecutable relativo (p. ej. .venv\Scripts\python.exe) se
    // resuelve contra el cwd del proceso, no contra `cwd` → lo hacemos absoluto.
    const looksLikePath = raw[0].includes("/") || raw[0].includes("\\");
    const step =
      looksLikePath && !path.isAbsolute(raw[0]) ? [path.resolve(cwd, raw[0]), ...raw.slice(1)] : raw;
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

// ── Compilación ────────────────────────────────────────────

function runSteps(color, name, cwd, steps, env = process.env) {
  for (const step of steps) {
    console.log(`${color}[${name}]${C.reset} 🔨 ${step.join(" ")}`);
    const r = spawnSync(step[0], step.slice(1), {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      env,
    });
    if (r.status !== 0) {
      console.error(`${color}[${name}]${C.reset} ✘ falló: ${step.join(" ")}`);
      return false;
    }
  }
  return true;
}

function buildService(svc) {
  const color = C[svc.name] || "";
  const cwd = path.join(ROOT, svc.dir);

  // Backend: nest build + compilación aparte de drizzle/ (el runtime lo importa
  // desde dist; mismo paso que hace el Dockerfile de producción).
  if (svc.name === "backend") {
    return runSteps(color, svc.name, cwd, [
      ["npm", "run", "build"],
      [
        localBin(cwd, "tsc"),
        "--outDir", "dist",
        "--rootDir", ".",
        "--module", "nodenext",
        "--moduleResolution", "nodenext",
        "--target", "ES2023",
        "--esModuleInterop",
        "--skipLibCheck",
        "--declaration", "false",
        "--sourceMap", "false",
        "drizzle/schema.ts",
        "drizzle/relations.ts",
      ],
    ]);
  }

  if (Array.isArray(svc.build) && svc.build.length) {
    // Los fronts Vite hornean `VITE_API_URL` en el bundle → se lo pasamos al build.
    return runSteps(color, svc.name, cwd, svc.build, frontBuildEnv());
  }

  return true; // bot: Python, nada que compilar
}

// ── Arranque de servicios ───────────────────────────────────

function resolveCmd(svc) {
  const cwd = path.join(ROOT, svc.dir);

  if (svc.name === "backend") {
    // Espejo de docker-entrypoint.sh: prefiere dist/src/main.js, si no dist/main.js.
    const main =
      fs.existsSync(path.join(cwd, "dist", "src", "main.js")) ||
      fs.existsSync(path.join(cwd, "dist", "main.js"));
    if (!main) {
      console.warn(
        `${C.backend}[backend]${C.reset} ⚠️  No se encontró backend/dist — compila con: node prod.js --build`,
      );
      return null;
    }
    const entry = fs.existsSync(path.join(cwd, "dist", "src", "main.js"))
      ? "dist/src/main.js"
      : "dist/main.js";
    return ["node", entry];
  }

  if (svc.name === "bot") {
    const py = path.join(cwd, PY_VENV_PY);
    if (!fs.existsSync(py)) {
      const base = (PY_BASE || ["python3"]).join(" ");
      console.warn(
        `${C.bot}[bot]${C.reset} ⚠️  ${svc.dir}/.venv no existe — ` +
          `crealo con: ${base} -m venv ${svc.dir}/.venv && ${path.join(svc.dir, PY_VENV_PY)} -m pip install -r ${svc.dir}/requirements.txt`,
      );
      return null;
    }
    return [py, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"];
  }

  // Fronts: sirve el `dist` ya compilado en su puerto fijo (no el 4173 por defecto).
  const port = new URL(svc.url).port;
  return [localBin(cwd, "vite"), "preview", "--host", "0.0.0.0", "--port", port];
}

function startService(svc) {
  const color = C[svc.name] || "";
  console.log(`${color}[${svc.name}]${C.reset} ▶ ${svc.url || svc.dir}  (log: logs/${svc.name}.prod.log)`);

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
    detached: DETACHED, // POSIX: grupo propio · Windows: sin consola (sin ventana)
    shell: process.platform === "win32",
    env: serviceEnv(svc),
  });

  child.on("error", (err) => {
    console.error(`${color}[${svc.name}]${C.reset} ✘ no se pudo arrancar: ${err.message}`);
  });
  child.unref();
  fs.closeSync(fd);
  return child.pid;
}

// ── Salida ─────────────────────────────────────────────────

function printUrls(services, showDb, showOsrm) {
  console.log("\n━━━━━━━━━━━━━ Mercaldas (PRODUCCIÓN) — URLs ━━━━━━━━━━━━━");
  for (const svc of services) {
    if (!svc.url) continue;
    console.log(`  ${svc.name.toUpperCase().padEnd(8)} → ${svc.url}`);
  }
  if (showDb) console.log("  DB             → PostgreSQL localhost:5432 (docker)");
  if (showOsrm) console.log("  OSRM           → Rutas http://localhost:5000 (docker, Manizales)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const started = services.map((s) => s.name).join(", ");
  console.log(`Logs: logs/*.prod.log  (${started || "sin servicios"}).`);
  console.log("🔐 Para exponer con dominios/HTTPS añade un Caddy por delante (siguiente paso).");
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
  if (!entries.length) console.log("No hay servicios registrados (logs/.pids.prod.json).");
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

  // Red de seguridad: liberar los puertos de los servicios.
  for (const svc of SERVICES) {
    if (svc.url) killPort(new URL(svc.url).port);
  }

  // OSRM corre como contenedor (no como proceso node): se detiene aparte.
  spawnSync("docker", ["compose", "stop"], { cwd: OSRM_DIR, stdio: "ignore" });

  try {
    fs.unlinkSync(PIDS_FILE);
  } catch {
    /* noop */
  }
  console.log("\n💡 La BD (docker) sigue corriendo. Para detenerla: cd db/docker && docker compose stop");
  console.log("   OSRM (rutas): cd delivery-routing && docker compose stop");
}

// ── Ayuda ─────────────────────────────────────────────────

const APP_LABELS = {
  backend: "API backend (NestJS)",
  web: "Cliente web",
  admin: "Panel admin web",
  picking: "Picking web",
  "picking-admin": "Picking admin web",
  "delivery-admin": "Delivery admin web",
  bot: "Bot (Python)",
};

function selectorFlags(name) {
  const flags = [];
  for (const [alias, n] of Object.entries(APP_ALIASES)) {
    if (n === name) flags.push("--" + alias);
  }
  return flags.sort((a, b) => Number(b === "--" + name) - Number(a === "--" + name));
}

function helpDeps(name) {
  const deps = (APP_DEPENDS[name] ?? []).map((d) =>
    d === "db" ? "PostgreSQL :5432" : d,
  );
  return deps.length ? "requiere " + deps.join(" + ") : "";
}

function printHelp() {
  const out = [];
  out.push("🚀 Mercaldas launcher de PRODUCCIÓN — node prod.js (en la raíz)");
  out.push("");
  out.push("USO");
  out.push("  node prod.js --build              → compila TODO y levanta (backend + 5 fronts + bot + BD + OSRM)");
  out.push("  node prod.js                       → levanta TODO usando los dist ya compilados");
  out.push("  node prod.js <flags>               → solo los aplicativos pedidos (+ sus dependencias)");
  out.push("  node prod.js --build <flags>       → compila y levanta solo lo pedido");
  out.push("  node prod.js --no-build            → fuerza no recompilar (equivale al comportamiento por defecto)");
  out.push("  node prod.js --stop                → detiene los servicios de prod.js");
  out.push("  node prod.js --init-config         → crea prod.config.json (plantilla de dominios)");
  out.push("  node prod.js --dns                 → muestra los registros DNS a configurar en tu proveedor");
  out.push("  node prod.js --write-caddy         → genera deploy/Caddyfile (proxy + TLS) desde la config");
  out.push("  node prod.js --config <ruta>       → usa otro archivo de configuración");
  out.push("  node prod.js --help                → esta ayuda");
  out.push("");
  out.push("APLICATIVOS (cada uno levanta sus dependencias, ver columna DEP)");
  const order = [
    "web",
    "admin",
    "picking",
    "picking-admin",
    "delivery-admin",
    "backend",
    "bot",
  ];
  const rows = order.map((name) => {
    const svc = SERVICES.find((s) => s.name === name);
    return {
      flags: selectorFlags(name).join(" / "),
      label: APP_LABELS[name] + (svc ? ` (${svc.dir})` : ""),
      url: svc?.url ?? "",
      deps: helpDeps(name),
    };
  });
  const wFlags = Math.max(...rows.map((r) => r.flags.length));
  const wLabel = Math.max(...rows.map((r) => r.label.length));
  const wUrl = Math.max(...rows.map((r) => r.url.length));
  for (const r of rows) {
    out.push(`  ${r.flags.padEnd(wFlags)}  ${r.label.padEnd(wLabel)}  ${r.url.padEnd(wUrl)}  ${r.deps}`.trimEnd());
  }
  out.push("");
  out.push("BASES DE DATOS Y RUTAS");
  out.push("  PostgreSQL principal (:5432) se levanta con cualquier app (dependencia del backend).");
  out.push("  --osrm   Motor de rutas OSRM (:5000) — Manizales (sin apps).");
  out.push("");
  out.push("CONFIGURACIÓN (prod.config.json)");
  out.push("  Define aquí los dominios y la IP; prod.js deriva de ahí VITE_API_URL (build de los");
  out.push("  fronts) y CORS_ORIGIN (backend), y te imprime los registros DNS a crear.");
  out.push("    { \"baseDomain\": \"tudominio.com\", \"publicIp\": \"<IP_WAN>\", \"acmeEmail\": \"admin@tudominio.com\" }");
  out.push("  (con solo baseDomain se generan client.<dom>, admin.<dom>, api.<dom>, ml.<dom>, …)");
  out.push("");
  out.push("CONFIGURACIÓN DE ENTORNO");
  out.push("  El backend lee sus variables desde backend/.env (DATABASE_URL, JWT_SECRET,");
  out.push("  claves Cloudinary/DeepSeek/Wompi/Epayco/Resend, etc.). prod.js añade NODE_ENV=production");
  out.push("  y CORS_ORIGIN a partir de prod.config.json.");
  out.push("");
  out.push("EJEMPLOS");
  out.push("  node prod.js --build --delivery-admin   → compila delivery admin + backend + BD");
  out.push("  node prod.js --admin --picking          → levanta admin + picking (usa dist ya compilados)");
  out.push("");
  out.push("Notas: --client es alias de --web · logs en logs/<servicio>.prod.log · PIDs en logs/.pids.prod.json");
  console.log(out.join("\n"));
}

// ── Configuración (prod.config.json) ────────────────────────

// Etiqueta por defecto de cada host cuando solo defines `baseDomain`.
const HOST_LABELS = {
  web: "client",
  admin: "admin",
  picking: "picking",
  "picking-admin": "picking-admin",
  "delivery-admin": "delivery-admin",
  api: "api",
  ml: "ml",
};
const FRONT_SERVICES = ["web", "admin", "picking", "picking-admin", "delivery-admin"];

let CONFIG = null;

/** IP pública WAN (best-effort). Sirve para imprimir el valor correcto del DNS. */
function detectPublicIp() {
  for (const url of ["https://api.ipify.org", "https://ifconfig.me"]) {
    try {
      const r = spawnSync("curl", ["-s", "--max-time", "5", url], { encoding: "utf8" });
      const ip = (r.stdout || "").trim();
      if (r.status === 0 && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {
      /* sin red: se deja vacío */
    }
  }
  return "";
}

/** Lee prod.config.json (o el indicado con --config) y completa hosts por defecto. */
function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    const rel = path.relative(ROOT, CONFIG_PATH) || CONFIG_PATH;
    if (fs.existsSync(CONFIG_PATH)) {
      console.warn(`⚠️  No se pudo leer ${rel}: ${e.message}`);
    } else {
      console.warn(`⚠️  No existe ${rel} — usando localhost. Créalo con: node prod.js --init-config`);
    }
  }

  const baseDomain = (raw.baseDomain || "").trim();
  const hosts = {};
  for (const [key, label] of Object.entries(HOST_LABELS)) {
    const explicit = raw.hosts?.[key];
    hosts[key] = explicit || (baseDomain ? `${label}.${baseDomain}` : "");
  }

  return {
    baseDomain,
    publicIp: (raw.publicIp || "").trim() || detectPublicIp(),
    localIp: (raw.localIp || "").trim(),
    acmeEmail: (raw.acmeEmail || "").trim(),
    tls: raw.tls !== false,
    hosts,
  };
}

function schemeOf(cfg) {
  return cfg && cfg.tls ? "https" : "http";
}

/** URL pública del backend (se hornea en los fronts como VITE_API_URL). */
function apiBaseUrl() {
  if (!CONFIG || !CONFIG.hosts.api) return "http://localhost:3000";
  return `${schemeOf(CONFIG)}://${CONFIG.hosts.api}`;
}

/** Orígenes permitidos por CORS: las URLs públicas de cada front. */
function corsOrigins() {
  if (!CONFIG) return [];
  return FRONT_SERVICES.map((s) => CONFIG.hosts[s])
    .filter(Boolean)
    .map((h) => `${schemeOf(CONFIG)}://${h}`);
}

function frontBuildEnv() {
  return { ...process.env, VITE_API_URL: apiBaseUrl() };
}

function serviceEnv(svc) {
  if (svc.name === "backend") {
    const cors = corsOrigins();
    return {
      ...process.env,
      NODE_ENV: "production",
      ...(cors.length ? { CORS_ORIGIN: cors.join(",") } : {}),
    };
  }
  return process.env;
}

/** Heurística: IP privada, loopback o CGNAT (no sirve para exponer). */
function isPrivateIp(ip) {
  if (!ip) return true;
  if (/^(10\.|127\.|192\.168\.|169\.254\.)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT 100.64/10
  return false;
}

/** Imprime los registros DNS a configurar en el proveedor de dominio. */
function printDns() {
  const cfg = CONFIG || loadConfig();
  const scheme = schemeOf(cfg);

  const rows = [];
  const push = (host, target) => {
    if (host) rows.push({ host, target });
  };
  push(cfg.hosts.api, "backend (3000) · bot (8000)");
  push(cfg.hosts.ml, "Astaroth (ML)");
  for (const s of FRONT_SERVICES) push(cfg.hosts[s], s);

  console.log("\n━━━━━━━━━━━ DNS a configurar en tu proveedor de dominio ━━━━━━━━━━━");
  if (!rows.length) {
    console.log("  ⚠️  No hay dominios configurados. Crea prod.config.json (node prod.js --init-config)");
    console.log("     y define `baseDomain` o el mapa `hosts`, luego vuelve a ejecutar prod.js.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    return;
  }

  console.log(`  Dominio base : ${cfg.baseDomain || "(no definido)"}`);
  console.log(`  IP pública   : ${cfg.publicIp || "(no definida — averíguala o configura DDNS)"}`);
  if (cfg.publicIp && isPrivateIp(cfg.publicIp)) {
    console.log(`  ⚠️  Esa IP es privada/CGNAT: apunta los DNS a la IP WAN del router (no a ${cfg.publicIp}).`);
  }

  console.log("\n  1) Registros DNS (tipo A → tu IP pública):");
  const wHost = Math.max(...rows.map((r) => r.host.length));
  for (const r of rows) {
    console.log(`     ${r.host.padEnd(wHost)}   A   ${cfg.publicIp || "<TU_IP_PUBLICA>"}`);
  }
  console.log(
    "     (en VPS la IP es fija; solo si fuera una red doméstica con IP dinámica necesitas DDNS)",
  );

  console.log("\n  2) Abre los puertos 80 y 443 en el servidor:");
  console.log("     • VPS: en el firewall del PROVEEDOR (security group) y en el del sistema operativo.");
  console.log("     • Windows: reglas de entrada TCP 80 y 443 en Windows Defender Firewall");
  console.log("       (y comprueba que IIS/HTTP.sys no los estén ocupando).");
  if (cfg.localIp) {
    console.log(`     • Red local: reenvía en el router TCP 80 y 443 → ${cfg.localIp}.`);
  }
  console.log("     NO abras puertos internos (3000, 5173, 8000, 8443-8447, 5432, 5000): solo 80 y 443.");

  console.log("\n  3) Mapa dominio → servicio interno (lo aplica el proxy Caddy):");
  for (const r of rows) {
    console.log(`     ${scheme}://${r.host}  →  ${r.target}`);
  }
  if (!cfg.acmeEmail) {
    console.log("\n  ℹ️  Define `acmeEmail` en prod.config.json para Let's Encrypt (avisos de expiración).");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function initConfig() {
  const rel = path.relative(ROOT, CONFIG_PATH) || CONFIG_PATH;
  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`ℹ️  Ya existe ${rel} — edítalo o usa --config <ruta>.`);
    return;
  }
  const template = {
    baseDomain: "tudominio.com",
    publicIp: "",
    localIp: "",
    acmeEmail: "admin@tudominio.com",
    tls: true,
    hosts: {
      web: "client.tudominio.com",
      admin: "admin.tudominio.com",
      picking: "picking.tudominio.com",
      "picking-admin": "picking-admin.tudominio.com",
      "delivery-admin": "delivery-admin.tudominio.com",
      api: "api.tudominio.com",
      ml: "ml.tudominio.com",
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(template, null, 2) + "\n");
  console.log(`✅ Creado ${rel} — edita dominios/IP y vuelve a ejecutar prod.js.`);
}

// ── Caddyfile (proxy + TLS) ─────────────────────────────────

// Astaroth (ML) no lo levanta prod.js: si expones ml.<dominio>, debe estar
// corriendo aparte en este puerto.
const ASTAROTH_PORT = 10001;

function servicePort(name) {
  const svc = SERVICES.find((s) => s.name === name);
  return svc ? new URL(svc.url).port : null;
}

/** Genera el Caddyfile (TLS automático + rutas por dominio) desde la config. */
function caddyfileText(cfg) {
  const out = [];
  out.push("# Generado por prod.js desde prod.config.json — NO editar a mano.");
  out.push("# Ejecuta: caddy run --config deploy/Caddyfile --adapter caddyfile");
  out.push("");
  out.push("{");
  if (cfg.acmeEmail) out.push(`\temail ${cfg.acmeEmail}`);
  out.push("}");
  out.push("");

  // Un site block por front: dominio → su puerto interno (vite preview).
  for (const name of FRONT_SERVICES) {
    const host = cfg.hosts[name];
    const port = servicePort(name);
    if (!host || !port) continue;
    out.push(`${host} {`);
    out.push("\tencode zstd gzip");
    out.push(`\treverse_proxy 127.0.0.1:${port}`);
    out.push("}");
    out.push("");
  }

  // API: backend en la raíz y el bot bajo /bot (mismo esquema que el contenedor).
  const api = cfg.hosts.api;
  const backendPort = servicePort("backend");
  const botPort = servicePort("bot");
  if (api && backendPort) {
    out.push(`${api} {`);
    out.push("\tencode zstd gzip");
    if (botPort) {
      out.push("\thandle_path /bot/* {");
      out.push(`\t\treverse_proxy 127.0.0.1:${botPort}`);
      out.push("\t}");
    }
    out.push("\thandle {");
    out.push(`\t\treverse_proxy 127.0.0.1:${backendPort}`);
    out.push("\t}");
    out.push("}");
    out.push("");
  }

  // Astaroth (ML): opcional; requiere el servicio corriendo aparte.
  if (cfg.hosts.ml) {
    out.push(`# Requiere Astaroth corriendo en 127.0.0.1:${ASTAROTH_PORT} (proyecto aparte).`);
    out.push(`${cfg.hosts.ml} {`);
    out.push("\tencode zstd gzip");
    out.push(`\treverse_proxy 127.0.0.1:${ASTAROTH_PORT}`);
    out.push("}");
    out.push("");
  }

  return out.join("\n");
}

function writeCaddyfile() {
  const cfg = CONFIG || loadConfig();
  const dir = path.join(ROOT, "deploy");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "Caddyfile");
  fs.writeFileSync(file, caddyfileText(cfg) + "\n");
  const rel = path.relative(ROOT, file);
  console.log(`✅ Caddyfile generado: ${rel}`);
  console.log(`   Ejecuta: caddy run --config ${rel.replace(/\\/g, "/")} --adapter caddyfile`);
  return file;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  if (HELP) {
    printHelp();
    return;
  }
  // Flag desconocido ⇒ no se ejecuta nada (antes se interpretaba como "todo").
  const unknown = unknownFlags();
  if (unknown.length) {
    console.error(`✘ Flag(s) desconocido(s): ${unknown.join(", ")} — no se levanta nada.`);
    console.error("  Usa `node prod.js --help` para ver las opciones.");
    process.exit(1);
  }
  if (INIT_CONFIG) return initConfig();

  CONFIG = loadConfig();
  if (WRITE_CADDY) return writeCaddyfile();
  if (DNS_ONLY) return printDns();
  if (STOP) return stopAll();

  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const plan = resolveSelection(); // null ⇒ todo
  const wantDb = plan === null || plan.includes("db");
  const wantOsrm = plan === null || plan.includes("osrm");
  const svcNames =
    plan === null
      ? SERVICES.map((s) => s.name)
      : plan.filter((n) => n !== "db" && n !== "osrm");
  const services = SERVICES.filter((s) => svcNames.includes(s.name));

  console.log(
    `🚀 Mercaldas — PRODUCCIÓN · selección: ${selectionLabel(plan)}${BUILD ? " (con build)" : ""}  (logs → logs/*.prod.log)`,
  );
  console.log(
    `🌐 API pública (VITE_API_URL): ${apiBaseUrl()}` +
      (CONFIG.baseDomain ? `  ·  dominio base: ${CONFIG.baseDomain}` : "  ·  (sin prod.config.json → localhost)"),
  );
  if (PM === "npm")
    console.warn(`${C.picking}[pnpm]${C.reset} ⚠️  pnpm no está instalado — se usará npm en los fronts.`);
  console.log("");

  // 1. Dependencias (necesarias antes de compilar/arrancar).
  const sinDeps = new Set();
  for (const svc of services) {
    if (!ensureDeps(svc)) sinDeps.add(svc.name);
  }

  // 2. Compilación (--build).
  if (BUILD && !NO_BUILD) {
    console.log("");
    if (apiBaseUrl() === "http://localhost:3000") {
      console.warn(
        `${C.web}[build]${C.reset} ⚠️  VITE_API_URL quedaría en localhost: los fronts compilados NO podrán hablar con el backend remoto.\n` +
          `             Configura prod.config.json (hosts.api) antes de compilar los fronts.`,
      );
    }
    for (const svc of services) {
      if (sinDeps.has(svc.name)) continue;
      if (!buildService(svc)) {
        console.error(`${C[svc.name]}[${svc.name}]${C.reset} ✘ build fallido — se omite al arrancar.`);
        sinDeps.add(svc.name);
      }
    }
    console.log("");
  } else {
    const backendSvc = services.find((s) => s.name === "backend");
    if (backendSvc && !fs.existsSync(path.join(ROOT, "backend", "dist"))) {
      console.warn(`${C.backend}[backend]${C.reset} ⚠️  backend/dist no existe. ¿Olvidaste --build?`);
    }
  }

  // 3. Bases de datos y OSRM.
  if (wantDb) {
    startDatabase();
    const dbUp = await waitForPort(5432, 90000);
    if (!dbUp)
      console.warn(`${C.db}[db]${C.reset} ⚠️  PostgreSQL no responde en :5432; los servicios reintentarán al conectar.`);
  }
  if (!wantDb)
    console.log(`${C.db}[db]${C.reset} 🚫 PostgreSQL no iniciado (esta selección no lo necesita).`);

  if (wantOsrm) {
    startOsrm();
    const osrmUp = await waitForPort(OSRM_PORT, 90000);
    if (!osrmUp)
      console.warn(`${C.osrm}[osrm]${C.reset} ⚠️  OSRM no responde en :${OSRM_PORT} — ¿corriste delivery-routing/prepare.sh?`);
  }

  // 4. Servicios de aplicación.
  const pids = {};
  for (const svc of services) {
    if (sinDeps.has(svc.name)) continue;
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

  // Esperar al backend antes de cerrar (para ver si arrancó bien).
  const backendSvc = services.find((s) => s.name === "backend");
  if (backendSvc && backendSvc.url) {
    const backendPort = Number(new URL(backendSvc.url).port);
    console.log(`${C.backend}[backend]${C.reset} ⏳ esperando a que esté listo (${backendSvc.url})...`);
    const backendUp = await waitForPort(backendPort, 120000);
    if (backendUp) {
      console.log(`${C.backend}[backend]${C.reset} ✅ Backend listo`);
    } else {
      console.warn(`${C.backend}[backend]${C.reset} ⚠️  No respondió en :${backendPort} — revisa logs/backend.prod.log`);
    }
  }

  printUrls(services, wantDb, wantOsrm);
  printDns();
}

main();
