#!/usr/bin/env node
/**
 * prod.js — despliegue de PRODUCCIÓN de MercAldas (bare-metal, sin contenedores
 * de aplicación; solo las bases de datos y OSRM corren en Docker).
 *
 * Es la contraparte de `dev.js` para producción:
 *   - compila los artefactos (backend NestJS + los 6 fronts Vite) con `--build`
 *   - sirve los fronts ya compilados con `vite preview` (estático, no dev server)
 *   - levanta backend, bot e ia-service en modo producción
 *   - mantiene las bases de datos (5432 / 5436) y OSRM (5000) vía Docker
 *
 * NO arranca las apps móviles (Expo): en producción se compilan a APK/IPA y
 * apuntan al backend por `EXPO_PUBLIC_API_URL`; aquí no se sirve un dev server.
 *
 * El siguiente paso para exponerlo con dominios (HTTPS) es un Caddy por delante
 * que rutee cada dominio → estos puertos internos; eso se monta aparte.
 *
 * Uso rápido:
 *   node prod.js --build           → compila TODO y levanta
 *   node prod.js                   → levanta TODO (usa los dist ya existentes)
 *   node prod.js --web --backend   → solo cliente web + API (+ sus dependencias)
 *   node prod.js --stop            → detiene los servicios de prod.js
 *   node prod.js --help            → ayuda
 */

const { spawn, spawnSync } = require("child_process");
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
const PYTHON_DEPS = {
  marker: [".venv", "bin", "python"],
  markerType: "file",
  install: [
    ["python3", "-m", "venv", ".venv"],
    [".venv", "bin", "pip", "install", "-r", "requirements.txt"],
  ],
};

// Colores de terminal (igual que dev.js).
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
    name: "analytics",
    dir: "Interface web analytics",
    url: "http://localhost:8444",
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
  {
    name: "ia",
    dir: "ia-service",
    url: "http://localhost:8002",
    deps: PYTHON_DEPS,
  },
];

const APP_ALIASES = {
  client: "web",
  web: "web",
  backend: "backend",
  admin: "admin",
  analytics: "analytics",
  picking: "picking",
  "picking-admin": "picking-admin",
  "delivery-admin": "delivery-admin",
  bot: "bot",
  ia: "ia",
  osrm: "osrm",
};

const APP_DEPENDS = {
  backend: ["db"],
  web: ["backend"],
  admin: ["backend"],
  analytics: ["backend", "db-campaigns"],
  picking: ["backend"],
  "picking-admin": ["backend"],
  "delivery-admin": ["backend"],
  bot: ["backend"],
  ia: ["backend"],
  osrm: [],
};

const NO_SELECTOR_FLAGS = new Set(["--stop", "--help", "--build", "--no-build", "--all"]);

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

function startDatabaseCampaigns() {
  const dbDir = path.join(ROOT, "db-campaigns");
  console.log(`${C.db}[db-campaigns]${C.reset} 🗄️  PostgreSQL analytics (docker compose up -d) → logs/db.prod.log`);
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
  console.warn(`${C.db}[db-campaigns]${C.reset} ⚠️  No se pudo levantar PostgreSQL analytics (logs/db.prod.log).`);
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

// ── Compilación ────────────────────────────────────────────

function runSteps(color, name, cwd, steps) {
  for (const step of steps) {
    console.log(`${color}[${name}]${C.reset} 🔨 ${step.join(" ")}`);
    const r = spawnSync(step[0], step.slice(1), {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
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
    return runSteps(color, svc.name, cwd, svc.build);
  }

  return true; // bot / ia-service: Python, nada que compilar
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

  if (svc.name === "bot" || svc.name === "ia") {
    const py = path.join(cwd, ".venv", "bin", "python");
    if (!fs.existsSync(py)) {
      console.warn(
        `${C[svc.name]}[${svc.name}]${C.reset} ⚠️  ${svc.dir}/.venv no existe — ` +
          `crealo con: python3 -m venv ${svc.dir}/.venv && ${svc.dir}/.venv/bin/pip install -r ${svc.dir}/requirements.txt`,
      );
      return null;
    }
    const port = svc.name === "bot" ? "8000" : "8002";
    return [py, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", port];
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
    detached: true, // grupo de procesos propio: sobrevive a la terminal
    shell: process.platform === "win32",
  });

  child.on("error", (err) => {
    console.error(`${color}[${svc.name}]${C.reset} ✘ no se pudo arrancar: ${err.message}`);
  });
  child.unref();
  fs.closeSync(fd);
  return child.pid;
}

// ── Salida ─────────────────────────────────────────────────

function printUrls(services, showDb, showCampaigns, showOsrm) {
  console.log("\n━━━━━━━━━━━━━ MercAldas (PRODUCCIÓN) — URLs ━━━━━━━━━━━━━");
  for (const svc of services) {
    if (!svc.url) continue;
    console.log(`  ${svc.name.toUpperCase().padEnd(8)} → ${svc.url}`);
  }
  if (showDb) console.log("  DB             → PostgreSQL localhost:5432 (docker)");
  if (showCampaigns) console.log("  DB-CAMPAIGNS   → PostgreSQL localhost:5436 (docker, analytics)");
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
  console.log("   La BD de analytics: cd db-campaigns && docker compose stop");
  console.log("   OSRM (rutas): cd delivery-routing && docker compose stop");
}

// ── Ayuda ─────────────────────────────────────────────────

const APP_LABELS = {
  backend: "API backend (NestJS)",
  web: "Cliente web",
  admin: "Panel admin web",
  analytics: "Panel analytics web",
  picking: "Picking web",
  "picking-admin": "Picking admin web",
  "delivery-admin": "Delivery admin web",
  bot: "Bot (Python)",
  ia: "Servicio IA (Python)",
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
    d === "db"
      ? "PostgreSQL :5432"
      : d === "db-campaigns"
        ? "db-campaigns :5436"
        : d,
  );
  return deps.length ? "requiere " + deps.join(" + ") : "";
}

function printHelp() {
  const out = [];
  out.push("🚀 MercAldas launcher de PRODUCCIÓN — node prod.js (en la raíz)");
  out.push("");
  out.push("USO");
  out.push("  node prod.js --build              → compila TODO y levanta (backend + 6 fronts + bot + IA + BDs + OSRM)");
  out.push("  node prod.js                       → levanta TODO usando los dist ya compilados");
  out.push("  node prod.js <flags>               → solo los aplicativos pedidos (+ sus dependencias)");
  out.push("  node prod.js --build <flags>       → compila y levanta solo lo pedido");
  out.push("  node prod.js --no-build            → fuerza no recompilar (equivale al comportamiento por defecto)");
  out.push("  node prod.js --stop                → detiene los servicios de prod.js");
  out.push("  node prod.js --help                → esta ayuda");
  out.push("");
  out.push("APLICATIVOS (cada uno levanta sus dependencias, ver columna DEP)");
  const order = [
    "web",
    "admin",
    "analytics",
    "picking",
    "picking-admin",
    "delivery-admin",
    "backend",
    "bot",
    "ia",
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
  out.push("  db-campaigns (:5436) solo con --analytics o sin flags (todo).");
  out.push("  --osrm   Motor de rutas OSRM (:5000) — Manizales (sin apps).");
  out.push("");
  out.push("CONFIGURACIÓN DE ENTORNO");
  out.push("  El backend lee sus variables desde backend/.env (DATABASE_URL, JWT_SECRET,");
  out.push("  CORS_ORIGIN, claves Cloudinary/DeepSeek/Wompi/Epayco/Resend, etc.).");
  out.push("  Los fronts se compilan con VITE_API_URL; definela al compilar:");
  out.push("    VITE_API_URL=https://api.tudominio node prod.js --build --web");
  out.push("");
  out.push("EJEMPLOS");
  out.push("  node prod.js --build --delivery-admin   → compila delivery admin + backend + BD");
  out.push("  node prod.js --build --analytics        → compila analytics + backend + BDs (incluye :5436)");
  out.push("  node prod.js --admin --picking          → levanta admin + picking (usa dist ya compilados)");
  out.push("");
  out.push("Notas: --client es alias de --web · logs en logs/<servicio>.prod.log · PIDs en logs/.pids.prod.json");
  console.log(out.join("\n"));
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  if (HELP) {
    printHelp();
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

  console.log(
    `🚀 MercAldas — PRODUCCIÓN · selección: ${selectionLabel(plan)}${BUILD ? " (con build)" : ""}  (logs → logs/*.prod.log)`,
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
  if (wantCampaigns) {
    startDatabaseCampaigns();
    const dbCampaignsUp = await waitForPort(5436, 90000);
    if (!dbCampaignsUp)
      console.warn(`${C.db}[db-campaigns]${C.reset} ⚠️  PostgreSQL analytics no responde en :5436.`);
  }
  if (!wantDb && !wantCampaigns)
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

  printUrls(services, wantDb, wantCampaigns, wantOsrm);
}

main();
