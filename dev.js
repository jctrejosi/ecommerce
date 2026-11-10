#!/usr/bin/env node
/**
 * Mercaldas — lanzador de servicios.
 *
 * Uso:
 *   node dev.js            # SOLO monta los servicios ya instalados (PostgreSQL +
 *                          #   backend + webs + bot + OSRM + delivery) en segundo
 *                          #   plano, espera a que el backend esté listo, imprime
 *                          #   las URLs y termina (la terminal queda libre).
 *   node dev.js --init     # Primer arranque: instala dependencias, compila todo
 *                          #   y migra la BD (PostgreSQL) desde el respaldo; luego
 *                          #   monta los servicios.
 *   node dev.js <flags>    # Solo los aplicativos pedidos (p. ej. --delivery-admin).
 *   node dev.js --fg       # Las apps Expo (delivery/picking) se quedan en
 *                          #   primer plano mostrando el QR (bloquea la terminal).
 *   node dev.js --prod     # PRODUCCIÓN ("en vivo"): comandos de producción.
 *                          #   Requiere builds previos (backend: npm run build,
 *                          #   webs: npm run build). Los logs quedan en logs/*.log.
 *   node dev.js --stop     # Detiene los servicios levantados por dev.js.
 *   node dev.js --migrate  # Restaura la BD desde db/backups/ecommerce y sale
 *                          #   (si ya tiene datos no la toca; con --force, sí).
 *   node dev.js --help     # Lista todos los comandos implementados.
 *
 * Logs: un archivo por servicio en logs/ (logs/<servicio>.log).
 *
 * La BD (docker) queda corriendo al salir; se detiene con
 * `cd db/docker && docker compose stop`. Junto a PostgreSQL se levanta también
 * Advantage/OpenADS (la BD del ERP, db/ads/openads) salvo con `--no-advantage`.
 */
const cp = require("node:child_process");
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
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const LOGS_DIR = path.join(ROOT, "logs");
const PIDS_FILE = path.join(LOGS_DIR, ".pids.json");
const DELIVERY_DIR = path.join(ROOT, "Interface movil delivery");
const DELIVERY_PORT = 8081;
const PICKING_MOBILE_DIR = path.join(ROOT, "Interface movil picking");
const PICKING_MOBILE_PORT = 8082;
const OSRM_DIR = path.join(ROOT, "delivery-routing");
const OSRM_PORT = 5000;

// BD principal (db/docker/docker-compose.yml) y respaldos versionados en
// db/backups/ecommerce/backup_<fecha>/ (troceados en ecommerce.dump.part-000,
// ...) para GitHub. Se restaura el subdirectorio con la fecha más reciente.
const DB_CONTAINER = "ecommerce_postgres";
const DB_NAME = "ecommerce";
const DB_BACKUP_DIR = path.join(ROOT, "db", "backups", "ecommerce");

// ── .env (sin dependencias) ─────────────────────────────────
// `dev.js` debe poder correr antes de `--init` (cuando aún no hay node_modules),
// así que no usa dotenv. Carga el mismo archivo que el backend/conector para que
// ERP_ADV_DATA, ERP_ADV_EXTERNAL, OPENADS_URL, etc. se configuren en un solo
// sitio. No pisa variables ya definidas en el entorno del proceso.
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
const ENV_FILES = process.env.DOTENV_CONFIG_PATH
  ? [process.env.DOTENV_CONFIG_PATH]
  : process.env.NODE_ENV === "production"
    ? ["backend/.env.production", "backend/.env", ".env"]
    : ["backend/.env.development.local", "backend/.env", ".env"];
for (const rel of ENV_FILES) loadEnvFile(path.resolve(ROOT, rel));

// Advantage (OpenADS): la BD del ERP, montada en Docker (db/ads/openads).
// La consume el conector ERP ⇄ Postgres (scripts-agent/erp). No es dependencia
// del ecommerce, así que si falta imagen/datos se avisa pero NO se aborta.
const ADV_DIR = path.join(ROOT, "db", "ads", "openads");
const ADV_IMAGE = "mercaldas/openads:1.09.73";
const ADV_CONTAINER = "openads-img";
// Producción: ERP_ADV_DATA=C:/ADD_FORTUNER (ruta real del ERP). Sin variable,
// usa la copia escribible del repo. Se puede definir en backend/.env.
const ADV_DATA = process.env.ERP_ADV_DATA
  ? path.resolve(process.env.ERP_ADV_DATA)
  : path.join(ADV_DIR, "data");
const ADV_DATA_SEED = path.join(ADV_DIR, "data-test"); // copia ya validada
// ERP_ADV_EXTERNAL=1: no levantar Docker; usar un OpenADS ya existente en
// OPENADS_URL (p. ej. el que sirve el ERP en la misma máquina).
const ADV_EXTERNAL = ["1", "true", "yes"].includes(
  String(process.env.ERP_ADV_EXTERNAL || "").toLowerCase(),
);
const ADV_WIRE_PORT = Number(process.env.ERP_ADV_WIRE_PORT || 16262); // wire ADS (ace*.dll)
const ADV_HTTP_PORT = Number(process.env.ERP_ADV_HTTP_PORT || 18080); // Studio / REST / SQL
const ADV_WIRE_USER = process.env.ERP_ADV_USER || "dsi";
const ADV_WIRE_PASS = process.env.ERP_ADV_PASS || "dsi";
// La API HTTP de OpenADS usa OPENADS_USER/PASS (lo mismo que los scripts);
// ERP_ADV_HTTP_* permite credenciales distintas para el contenedor.
const ADV_HTTP_USER =
  process.env.ERP_ADV_HTTP_USER || process.env.OPENADS_USER || ADV_WIRE_USER;
const ADV_HTTP_PASS =
  process.env.ERP_ADV_HTTP_PASS || process.env.OPENADS_PASS || ADV_WIRE_PASS;
const ADV_URL =
  process.env.OPENADS_URL || `http://localhost:${ADV_HTTP_PORT}`;

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes("--prod") || ARGS.includes("--live") ? "prod" : "dev";
const STOP = ARGS.includes("--stop");
const HELP = ARGS.includes("--help");
// `--migrate`: restaura el respaldo versionado (db/backups/ecommerce) y termina.
// `--force`:   permite sobrescribir una BD que ya tiene datos (solo con --migrate).
const MIGRATE = ARGS.includes("--migrate");
const FORCE = ARGS.includes("--force");
// Las apps móviles (Expo) corren desacopladas por defecto: así la terminal queda
// libre y se puede cerrar sin matar Metro. Con --fg se muestra el QR aquí mismo.
const FG = ARGS.includes("--fg") || ARGS.includes("--foreground");
// `--no-advantage`: no levantar el contenedor de la BD del ERP (OpenADS).
const NO_ADVANTAGE = ARGS.includes("--no-advantage");
// `--advantage`: fuerza la BD del ERP y el agente de salida. Usado solo, monta
// únicamente PostgreSQL + Advantage/OpenADS + sync-out (sin webs ni apps).
const ADVANTAGE = ARGS.includes("--advantage");
// `--init`: primer arranque — instala dependencias, compila todo y migra la BD
// (PostgreSQL) desde el respaldo; luego monta los servicios.
const INIT = ARGS.includes("--init");
// `--erp-sync`: además, deja corriendo la SALIDA Postgres → ERP en bucle
// (scripts-agent/erp/sync-out.mjs --apply). `--erp-interval=<seg>` lo ajusta.
const ERP_SYNC = ARGS.includes("--erp-sync");
const ERP_INTERVAL = (() => {
  const raw = ARGS.find((a) => a.toLowerCase().startsWith("--erp-interval="));
  const n = raw ? Number(raw.split("=")[1]) : Number(process.env.ERP_SYNC_INTERVAL || 30);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : 30;
})();

// Dependencias por servicio: `marker` es lo que se comprueba para saber si ya
// están instaladas; `install` son los comandos que las instalan si faltan.
const NPM_DEPS = {
  marker: ["node_modules"],
  markerType: "dir",
  install: [["npm", "install"]],
};

// Gestores de paquetes para los fronts y las apps Expo. Se prefiere pnpm (los
// fronts traen pnpm-lock.yaml); si no está instalado se cae a npm y, de última,
// a yarn. `PM` es el preferido (para `run`/`exec`); `PM_INSTALLERS` es la lista
// de candidatos que `ensureDeps`/`ensureExpoDeps` prueban en orden al instalar.
// npm se asume presente (viene con Node), así que nunca queda fuera de la lista.
// En Windows npm/pnpm/yarn son shims .cmd y Node exige `shell` para ejecutarlos.
const PM_SHELL = process.platform === "win32";
const PKG_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const PM_CANDIDATES = ["pnpm", "npm", "yarn"].filter((pm) => pm === "npm" || hasBin(pm));
const PM = PM_CANDIDATES[0];
const PM_INSTALLERS = PM_CANDIDATES;
const PNPM_DEPS = {
  marker: ["node_modules"],
  markerType: "dir",
  installers: PM_INSTALLERS,
};

function hasBin(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: PM_SHELL });
  return r.status === 0;
}

// ── Python (bot) ────────────────────────────────────────────
// En Windows `python3` no existe (es el alias de la Microsoft Store, que
// falla): el lanzador real es `python` o `py`. Además ahí el venv guarda el
// intérprete en Scripts\ en vez de bin/.
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

/** Intérprete base disponible (python3 → python → py -3 → instalaciones Windows). */
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

const C = {
  db: "\x1b[36m",
  backend: "\x1b[31m",
  web: "\x1b[32m",
  webclient: "\x1b[36m",
  admin: "\x1b[34m",
  "picking-admin": "\x1b[91m",
  "delivery-admin": "\x1b[93m",
  bot: "\x1b[35m",
  delivery: "\x1b[92m",
  "picking-mobile": "\x1b[94m",
  osrm: "\x1b[90m",
  advantage: "\x1b[33m",
  reset: "\x1b[0m",
};

const SERVICES = [
  {
    name: "backend",
    dir: "backend",
    url: "http://localhost:3000",
    dev: ["npm", "run", "dev"],
    prod: ["npm", "run", "start:prod"],
    build: [["npm", "run", "build"]],
    deps: NPM_DEPS,
  },
  {
    // Sirve el build de `Interface web client/dist` y hace de mismo-origen del
    // API; es lo que embebe el APK cliente (WebView) y lo que este descubre en
    // la red local (`GET /discovery`).
    name: "webclient",
    dir: ".",
    url: "http://localhost:4173",
    dev: ["node", "scripts-agent/serve-webclient.mjs", "4173"],
    prod: ["node", "scripts-agent/serve-webclient.mjs", "4173"],
    // El webclient sirve `Interface web client/dist`: --init lo compila.
    buildDir: "Interface web client",
    build: [[PM, "install"], [PM, "run", "build"]],
    // Escucha en 0.0.0.0 y resuelve el API en su propio origen, así que se
    // puede abrir tal cual desde el celular (es la URL que usa el APK).
    lan: true,
    deps: {
      marker: ["scripts-agent", "serve-webclient.mjs"],
      markerType: "file",
      install: [],
    },
  },
  {
    name: "admin",
    dir: "Interface web admin",
    url: "http://localhost:8443",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    build: [[PM, "run", "build"]],
    // Vite escucha en 0.0.0.0 y el backend acepta orígenes de la red local, así
    // que el panel se puede abrir desde el celular con la IP del equipo. El
    // cliente resuelve el API contra el host que sirvió la página
    // (`resolveApiBaseUrl` en `Interface web admin/src/lib/api.ts`).
    lan: true,
    deps: PNPM_DEPS,
  },
  {
    name: "picking-admin",
    dir: "Interface web picking admin",
    url: "http://localhost:8446",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    build: [[PM, "run", "build"]],
    // Vite escucha en 0.0.0.0 y el backend acepta orígenes de la red local
    // (`CORS_ALLOW_LAN`), así que se puede abrir desde el celular con la IP del
    // equipo. El cliente resuelve el API contra el host que sirvió la página.
    lan: true,
    deps: PNPM_DEPS,
  },
  {
    name: "delivery-admin",
    dir: "Interface web delivery admin",
    url: "http://localhost:8447",
    dev: [PM, "run", "dev"],
    prod: [PM, "run", "preview"],
    build: [[PM, "run", "build"]],
    // Vite escucha en 0.0.0.0 y el backend acepta orígenes de la red local
    // (`CORS_ALLOW_LAN`), así que el panel se puede abrir desde el celular con
    // la IP del equipo (la que imprime `dev.js`). El cliente resuelve el API
    // contra el host que sirvió la página.
    lan: true,
    deps: PNPM_DEPS,
  },
  {
    name: "bot",
    dir: "bot",
    url: "http://localhost:8000",
    dev: null, // se resuelve en resolveCmd() (intérprete del venv)
    prod: null, // se resuelve en resolveCmd()
    deps: PYTHON_DEPS,
  },
];

// ── Selección por aplicativo (flags --x) ─────────────────────
// Cada app declara sus dependencias; al pedirla se levanta también lo mínimo
// para que funcione (p. ej. --delivery-admin ⇒ backend + PostgreSQL).
const APP_ALIASES = {
  client: "webclient",
  webclient: "webclient",
  "client-apk": "webclient",
  backend: "backend",
  admin: "admin",
  "picking-admin": "picking-admin",
  "delivery-admin": "delivery-admin",
  bot: "bot",
  delivery: "delivery",
  "picking-mobile": "picking-mobile",
  "movil-picking": "picking-mobile",
  osrm: "osrm",
};

const APP_DEPENDS = {
  backend: ["db"],
  webclient: ["backend"], // sirve la web del cliente (APK/WebView) y proxy del API
  admin: ["backend"],
  "picking-admin": ["backend"],
  // El panel de delivery pinta rutas por calles (OSRM) en el mapa de flota.
  "delivery-admin": ["backend", "osrm"],
  bot: ["backend"],
  delivery: ["backend", "osrm"], // API real: backend (+BD) + OSRM para rutas
  "picking-mobile": ["backend"], // app móvil de picking (Expo, QR)
  osrm: [],
};

const NO_SELECTOR_FLAGS = new Set([
  "--prod",
  "--live",
  "--stop",
  "--help",
  "--migrate",
  "--force",
  "--all",
  "--fg",
  "--foreground",
  "--no-advantage",
  "--advantage",
  "--init",
  "--erp-sync",
  "--erp-interval",
]);

/** Flags `--x` no reconocidos. Si hay alguno, el launcher no ejecuta nada. */
function unknownFlags() {
  const valid = new Set(
    [...NO_SELECTOR_FLAGS, ...Object.keys(APP_ALIASES).map((k) => `--${k}`)].map((f) =>
      f.toLowerCase(),
    ),
  );
  return ARGS.filter((a) => {
    if (!a.startsWith("--")) return false;
    return !valid.has(a.toLowerCase().split("=")[0]); // admite --flag=valor
  });
}

/** null ⇒ levantar todo (comportamiento por defecto). */
function resolveSelection() {
  const requested = ARGS.filter((a) => a.startsWith("--"))
    .map((a) => a.toLowerCase().split("=")[0])
    .filter((k) => !NO_SELECTOR_FLAGS.has(k))
    .map((k) => k.slice(2));
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

/** Espera a que un OpenADS externo responda /api/health. */
async function waitForOpenAds(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  const auth =
    "Basic " + Buffer.from(`${ADV_HTTP_USER}:${ADV_HTTP_PASS}`).toString("base64");
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return true;
    } catch {
      /* reintenta */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
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

// ── Docker: CLI correcto y motor disponible ────────────────
// En Windows el motor puede estar en Docker Desktop (una instancia por usuario)
// o en un WSL antiguo con la API en loopback. Un `DOCKER_HOST` heredado que ya
// no responde es la causa mas comun de "Docker no esta disponible", asi que se
// descarta antes de rendirse: `node dev.js` debe funcionar sin lanzadores
// externos.

const DOCKER_DESKTOP_BIN = "C:\\Program Files\\Docker\\Docker\\resources\\bin";
const DOCKER_DESKTOP_EXE = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";

const fileExists = (p) => {
  try {
    return Boolean(p) && fs.existsSync(p);
  } catch {
    return false;
  }
};

/** Carpetas con `docker.exe`, en orden de preferencia. */
function dockerCliDirs() {
  if (process.platform !== "win32") return [];
  const dirs = [DOCKER_DESKTOP_BIN];
  if (process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, "Docker", "Docker", "resources", "bin"));
  }
  dirs.push("C:\\DockerCLI");
  return dirs.filter((dir) => fileExists(path.join(dir, "docker.exe")));
}

/** Ejecutable de Docker Desktop, si esta instalado. */
function dockerDesktopExe() {
  if (process.platform !== "win32") return null;
  const candidates = [DOCKER_DESKTOP_EXE];
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Docker", "Docker Desktop.exe"));
  }
  return candidates.find((exe) => fileExists(exe)) || null;
}

function dockerAnswers() {
  const r = spawnSync("docker", ["info"], {
    stdio: "ignore",
    timeout: 25000,
    windowsHide: true,
  });
  return r.status === 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let dockerReady = null;

/**
 * Deja `docker` utilizable en este proceso: prioriza el CLI de Docker Desktop,
 * descarta un DOCKER_HOST que no responde y, en Windows, arranca Docker
 * Desktop si hace falta. Devuelve true si el motor responde.
 * `MERCALDAS_NO_DOCKER_AUTOSTART=1` evita arrancarlo automaticamente.
 */
async function ensureDocker({ timeoutMs = 120000 } = {}) {
  if (dockerReady !== null) return dockerReady;
  const note = (msg) => console.log(`${C.db}[docker]${C.reset} ${msg}`);

  // 1) El CLI de Docker Desktop primero: el `docker.exe` viejo del PATH puede
  //    apuntar a un endpoint que ya no existe.
  const dirs = dockerCliDirs();
  if (dirs.length) {
    const current = (process.env.PATH || "").split(";").map((dir) => dir.trim().toLowerCase());
    const missing = dirs.filter((dir) => !current.includes(dir.toLowerCase()));
    if (missing.length) process.env.PATH = `${missing.join(";")};${process.env.PATH || ""}`;
  }

  if (dockerAnswers()) {
    dockerReady = true;
    return true;
  }

  // 2) DOCKER_HOST heredado que no responde: se descarta y se reintenta.
  if (process.env.DOCKER_HOST) {
    const broken = process.env.DOCKER_HOST;
    delete process.env.DOCKER_HOST;
    if (dockerAnswers()) {
      note(`se descarto DOCKER_HOST=${broken} (no responde); se usa el motor local.`);
      dockerReady = true;
      return true;
    }
  }

  // 3) Windows: arrancar Docker Desktop.
  const exe = process.env.MERCALDAS_NO_DOCKER_AUTOSTART ? null : dockerDesktopExe();
  if (exe) {
    note("Docker Desktop no responde; iniciandolo (puede tardar un minuto)...");
    try {
      cp.spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch {
      /* si no se puede lanzar, se informa abajo */
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(3000);
      if (dockerAnswers()) {
        note("✅ Docker Desktop listo");
        dockerReady = true;
        return true;
      }
    }
    note("⚠️  Docker Desktop no respondio a tiempo; revise su ventana (licencia/login).");
  }

  dockerReady = false;
  return false;
}

// ── Base de datos (Docker) ──────────────────────────────────

/** Crea la red compartida si no existe (el compose la declara `external`). */
function ensureDockerNetwork(name) {
  const exists = spawnSync("docker", ["network", "inspect", name], {
    stdio: "ignore",
  });
  if (exists.status === 0) return true;
  const created = spawnSync("docker", ["network", "create", "--internal", name], {
    stdio: "ignore",
    timeout: 30000,
  });
  return created.status === 0;
}

function startDatabase() {
  const dbDir = path.join(ROOT, "db", "docker");
  console.log(`${C.db}[db]${C.reset} 🐘 PostgreSQL (docker compose up -d) → logs/db.log`);
  ensureDockerNetwork("mercaldas_internal");

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
    `${C.db}[db]${C.reset} 💡 Docker no esta disponible: ${
      process.platform === "win32"
        ? "abra Docker Desktop y espere a que arranque el motor; si el CLI no esta en el PATH, agregue C:\\Program Files\\Docker\\Docker\\resources\\bin."
        : "arranca el daemon (sudo systemctl start docker) y, si hace falta, anade tu usuario al grupo docker."
    }`,
  );
  return false;
}

// ── Restauración del respaldo versionado (db/backups/ecommerce) ──
// Antes de la primera migración la BD local solo tiene las extensiones de
// init.sql (PostGIS, citext, ...). Si no existe la tabla `products` se asume un
// clon nuevo y se reensambla el respaldo (part-000, part-001, ...) para
// restaurarlo con pg_restore. Si ya hay datos, no se toca (salvo --force).
//
// `node dev.js --migrate` lo hace explícito y devuelve código de salida.
function dbIsInitialized() {
  const r = spawnSync(
    "docker",
    [
      "exec", DB_CONTAINER,
      "psql", "-U", "postgres", "-d", DB_NAME,
      "-tAc", "SELECT to_regclass('public.products') IS NOT NULL",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  return (r.stdout || "").trim() === "t";
}

/**
 * Directorio del respaldo a usar: el subdirectorio `backup_<fecha>` más
 * reciente dentro de db/backups/ecommerce/ (o la propia carpeta si todavía
 * tiene las partes sueltas — formato antiguo).
 */
function resolveBackupDir() {
  if (!fs.existsSync(DB_BACKUP_DIR)) return null;
  const entries = fs.readdirSync(DB_BACKUP_DIR, { withFileTypes: true });
  const dated = entries
    .filter((e) => e.isDirectory() && /^backup_\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (dated.length) return path.join(DB_BACKUP_DIR, dated[dated.length - 1]);
  const flat = entries.some(
    (e) =>
      e.isFile() &&
      (e.name === "ecommerce.dump" || /^ecommerce\.dump\.part-\d+$/.test(e.name)),
  );
  return flat ? DB_BACKUP_DIR : null;
}

function loadBackup() {
  const dir = resolveBackupDir();
  if (!dir) return null;
  const files = fs.readdirSync(dir);
  const single = files.includes("ecommerce.dump");
  const parts = files
    .filter((f) => /^ecommerce\.dump\.part-\d+$/.test(f))
    .sort();
  if (!single && parts.length === 0) return null;
  const names = single ? ["ecommerce.dump"] : parts;
  const buffer = Buffer.concat(
    names.map((n) => fs.readFileSync(path.join(dir, n))),
  );
  return { dir, names, buffer };
}

function restoreDatabaseIfNeeded({ force = false, explicit = false } = {}) {
  const backup = loadBackup();
  if (!backup) {
    if (explicit) {
      console.warn(
        `${C.db}[db]${C.reset} ⚠️  No hay respaldo en ${path.relative(ROOT, DB_BACKUP_DIR)} (falta un subdirectorio backup_<fecha> con las partes ecommerce.dump.part-*).`,
      );
    }
    return false;
  }

  const initialized = dbIsInitialized();
  if (initialized === null) {
    console.warn(
      `${C.db}[db]${C.reset} ⚠️  No se pudo verificar el estado de la BD; se omite la restauración del respaldo.`,
    );
    return false;
  }
  if (initialized && !force) {
    if (explicit) {
      console.log(
        `${C.db}[db]${C.reset} ℹ️  La BD ya tiene datos: no se restaura nada (usa --force para sobrescribir).`,
      );
    }
    return true; // ya tiene datos: no se sobrescribe
  }

  // Integridad: si existe el hash del volcado completo, se valida antes de restaurar.
  const shaFile = path.join(backup.dir, "ecommerce.dump.sha256");
  if (fs.existsSync(shaFile)) {
    const expected = fs.readFileSync(shaFile, "utf8").trim();
    const actual = crypto.createHash("sha256").update(backup.buffer).digest("hex");
    if (expected && expected !== actual) {
      console.error(
        `${C.db}[db]${C.reset} ✘ El respaldo no coincide con su hash (esperado ${expected.slice(0, 12)}…, obtenido ${actual.slice(0, 12)}…). Se omite la restauración.`,
      );
      return false;
    }
  }

  const mb = (backup.buffer.length / (1024 * 1024)).toFixed(1);
  console.log(
    `${C.db}[db]${C.reset} 📥 Restaurando respaldo del ecommerce (${backup.names.length} archivo(s), ${mb} MB)...`,
  );

  // Se reensambla a un temporal y se copia al contenedor con `docker cp`,
  // restaurando desde archivo (no por stdin): es la vía más portable entre
  // Linux/macOS/Windows (evita tuberías binarias y sus problemas en Windows).
  const relTmp = "logs/ecommerce_restore.dump";
  const hostTmp = path.join(ROOT, "logs", "ecommerce_restore.dump");
  const containerTmp = "/tmp/ecommerce_restore.dump";
  const { fd } = openLog("db");
  let status = 1;
  try {
    fs.writeFileSync(hostTmp, backup.buffer);
    const cp = spawnSync(
      "docker",
      ["cp", relTmp, `${DB_CONTAINER}:${containerTmp}`],
      { cwd: ROOT, stdio: ["ignore", fd, fd], timeout: 120000 },
    );
    if (cp.status === 0) {
      const r = spawnSync(
        "docker",
        [
          "exec", DB_CONTAINER,
          "pg_restore", "-U", "postgres", "-d", DB_NAME,
          "--clean", "--if-exists", "--no-owner", "--no-privileges",
          containerTmp,
        ],
        { stdio: ["ignore", fd, fd], timeout: 600000 },
      );
      status = r.status;
      // Limpieza del temporal dentro del contenedor (best-effort).
      spawnSync("docker", ["exec", DB_CONTAINER, "rm", "-f", containerTmp], {
        stdio: ["ignore", fd, fd],
      });
    } else {
      status = cp.status;
    }
  } finally {
    fs.closeSync(fd);
    fs.rmSync(hostTmp, { force: true });
  }

  if (status === 0) {
    // Verificación: si las tablas clave quedaron vacías, algo salió mal.
    const chk = spawnSync(
      "docker",
      [
        "exec", DB_CONTAINER,
        "psql", "-U", "postgres", "-d", DB_NAME, "-tAc",
        "SELECT 'branches=' || count(*) FROM branches UNION ALL SELECT 'products=' || count(*) FROM products",
      ],
      { encoding: "utf8" },
    );
    const counts = (chk.stdout || "").trim().split("\n").filter(Boolean).join(" ");
    console.log(`${C.db}[db]${C.reset} ✅ Respaldo restaurado${counts ? " — " + counts : ""}`);
    return true;
  } else {
    console.warn(
      `${C.db}[db]${C.reset} ⚠️  La restauración del respaldo falló (código ${status}; detalle en logs/db.log).`,
    );
    return false;
  }
}

/**
 * `node dev.js --migrate`: asegura PostgreSQL y restaura el respaldo versionado.
 * Devuelve el código de salida (0 = BD lista; 1 = no se pudo restaurar).
 */
async function runMigrate() {
  console.log(
    `${C.db}[db]${C.reset} 📦 Migrando la base de datos desde ${path.relative(ROOT, DB_BACKUP_DIR)}...`,
  );
  await ensureDocker();
  startDatabase();
  const dbUp = await waitForPort(5432, 90000);
  if (!dbUp) {
    console.error(`${C.db}[db]${C.reset} ✘ PostgreSQL no responde en :5432.`);
    return 1;
  }
  return restoreDatabaseIfNeeded({ force: FORCE, explicit: true }) ? 0 : 1;
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

// ── Advantage / OpenADS (BD del ERP, Docker) ──────────────────

/** ¿Existe la imagen Docker localmente? */
function dockerImageExists(img) {
  return spawnSync("docker", ["image", "inspect", img], { stdio: "ignore" }).status === 0;
}

/** ¿Existe el contenedor (corriendo o parado)? */
function dockerContainerExists(name) {
  return spawnSync("docker", ["container", "inspect", name], { stdio: "ignore" }).status === 0;
}

/** ¿Está corriendo ese contenedor? */
function dockerContainerRunning(name) {
  const r = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], {
    encoding: "utf8",
  });
  return r.status === 0 && (r.stdout || "").trim() === "true";
}

/**
 * Prepara el directorio de datos Advantage que se monta en el contenedor.
 * NUNCA se monta el original (db/ADD_ANALITICA): el motor escribe locks y
 * journal, así que la copia de trabajo debe ser escribible. Si no existe
 * `db/ads/openads/data` se siembra desde la copia ya validada `data-test`
 * (o, si el usuario la dejó ahí, desde db/ADD_ANALITICA).
 */
function ensureAdvantageData() {
  if (dirHasContent(ADV_DATA)) return true;
  if (process.env.ERP_ADV_DATA) {
    console.warn(
      `${C.advantage}[adv]${C.reset} ⚠️  ERP_ADV_DATA no existe o está vacío: ${ADV_DATA}`,
    );
    return false;
  }
  const seeds = [ADV_DATA_SEED, path.join(ROOT, "db", "ADD_ANALITICA")];
  for (const seed of seeds) {
    if (!dirHasContent(seed)) continue;
    try {
      fs.mkdirSync(ADV_DATA, { recursive: true });
      fs.cpSync(seed, ADV_DATA, { recursive: true });
      if (dirHasContent(ADV_DATA)) return true;
    } catch {
      /* intenta la siguiente semilla */
    }
  }
  return false;
}

/** Levanta el contenedor de Advantage (OpenADS) en segundo plano. */
function startAdvantage() {
  if (ADV_EXTERNAL) {
    console.log(
      `${C.advantage}[adv]${C.reset} 🛒 Advantage externo → ${ADV_URL} (no se levanta Docker)`,
    );
    return true;
  }

  const { fd } = openLog("advantage");
  const run = (args) =>
    spawnSync("docker", args, { stdio: ["ignore", fd, fd], timeout: 120000 });

  const alreadyExists = dockerContainerExists(ADV_CONTAINER);

  if (!alreadyExists) {
    if (!dockerImageExists(ADV_IMAGE)) {
      fs.closeSync(fd);
      console.warn(`${C.advantage}[adv]${C.reset} ⚠️  Falta la imagen ${ADV_IMAGE} (BD del ERP).`);
      console.warn(
        `${C.advantage}[adv]${C.reset} 💡 Constrúyela una vez:\n` +
          `      bash db/ads/openads/build.sh\n` +
          `      docker build -t ${ADV_IMAGE} -f db/ads/openads/Dockerfile db/ads/openads`,
      );
      return false;
    }
    if (!ensureAdvantageData()) {
      fs.closeSync(fd);
      console.warn(
        `${C.advantage}[adv]${C.reset} ⚠️  No hay tablas Advantage en ${path.relative(ROOT, ADV_DATA)}.`,
      );
      console.warn(
        `${C.advantage}[adv]${C.reset} 💡 Copia el ERP ahí: cp -r db/ADD_ANALITICA/. ${path.relative(ROOT, ADV_DATA)}/`,
      );
      return false;
    }
    run([
      "run", "-d", "--name", ADV_CONTAINER,
      "-p", `${ADV_WIRE_PORT}:6262`, "-p", `${ADV_HTTP_PORT}:8080`,
      ...(process.platform === "win32"
        ? ["--mount", `type=bind,source=${ADV_DATA.replace(/\\/g, "/")},target=/data`]
        : ["-v", `${ADV_DATA}:/data`]),
      "-e", "OPENADS_ERROR_LOG_PATH=/var/log/openads",
      ADV_IMAGE,
      "--data", "/data", "--host", "0.0.0.0", "--port", "6262",
      "--http_port", "8080",
      "--auth_user", `${ADV_WIRE_USER}:${ADV_WIRE_PASS}`,
      "--http_user", `${ADV_HTTP_USER}:${ADV_HTTP_PASS}`,
    ]);
  } else if (!dockerContainerRunning(ADV_CONTAINER)) {
    run(["start", ADV_CONTAINER]); // sobre uno ya corriendo devuelve !=0: no es error
  }
  fs.closeSync(fd);

  if (!dockerContainerRunning(ADV_CONTAINER)) {
    console.warn(
      `${C.advantage}[adv]${C.reset} ⚠️  No se pudo arrancar Advantage (detalle en logs/advantage.log).`,
    );
    return false;
  }
  console.log(
    `${C.advantage}[adv]${C.reset} 🛒 Advantage (ERP) → Studio ${ADV_URL} (${ADV_HTTP_USER})`,
  );
  return true;
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

  // Candidatos a probar en orden (p. ej. pnpm → npm → yarn): gana el primero
  // que instale bien. Esto cubre "pnpm no instalado" y "pnpm instalado pero roto".
  if (svc.deps.installers) {
    for (const pm of svc.deps.installers) {
      console.log(`${color}[${svc.name}]${C.reset}    · ${pm} install`);
      const r = spawnSync(pm, ["install"], { cwd, stdio: "inherit", shell: PM_SHELL });
      if (r.status === 0) {
        console.log(`${color}[${svc.name}]${C.reset} ✅ dependencias listas (${pm})`);
        return true;
      }
      console.warn(
        `${color}[${svc.name}]${C.reset} ⚠️  "${pm} install" falló; probando con el siguiente gestor...`,
      );
    }
    console.error(
      `${color}[${svc.name}]${C.reset} ✘ no se pudieron instalar las dependencias — se omite este servicio`,
    );
    return false;
  }

  if (!svc.deps.install) {
    console.error(
      `${color}[${svc.name}]${C.reset} ✘ no se encontró Python (python3/python/py); instálalo y reintenta — se omite este servicio`,
    );
    return false;
  }

  for (const step of svc.deps.install) {
    const r = spawnSync(step[0], step.slice(1), {
      cwd,
      stdio: "inherit",
      shell: PM_SHELL && PKG_MANAGERS.has(step[0]),
    });
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

/**
 * Compila un servicio si declara `build` (backend: `npm run build`; fronts:
 * `PM run build`). Solo lo usa `--init`; un fallo no bloquea el arranque dev.
 */
function buildService(svc) {
  if (!Array.isArray(svc.build) || svc.build.length === 0) return true;
  const color = C[svc.name] || "";
  const cwd = path.join(ROOT, svc.buildDir || svc.dir);
  console.log(`${color}[${svc.name}]${C.reset} 🔨 compilando...`);
  for (const step of svc.build) {
    const r = spawnSync(step[0], step.slice(1), {
      cwd,
      stdio: "inherit",
      shell: PM_SHELL && PKG_MANAGERS.has(step[0]),
    });
    if (r.status !== 0) {
      console.warn(
        `${color}[${svc.name}]${C.reset} ⚠️  falló el build: ${step.join(" ")} (se continúa; en dev no hace falta para el servidor de desarrollo)`,
      );
      return false;
    }
  }
  console.log(`${color}[${svc.name}]${C.reset} ✅ build listo`);
  return true;
}

// ── Plantillas de entorno (bootstrap de --init) ─────────────
// Si falta el archivo destino, se copia la plantilla (NUNCA sobrescribe). Los
// valores de las plantillas son de ejemplo/local; revisa los secretos.
const ENV_BOOTSTRAP = [
  {
    dest: ["backend", MODE === "prod" ? ".env" : ".env.development.local"],
    tpl: [".env.example"],
  },
  { dest: ["bot", ".env"], tpl: ["bot", ".env.example"] },
  { dest: ["Interface web admin", ".env"], tpl: ["Interface web admin", ".env.example"] },
  {
    dest: ["Interface movil delivery", ".env"],
    tpl: ["Interface movil delivery", ".env.example"],
  },
];

function ensureEnvFiles() {
  for (const { dest, tpl } of ENV_BOOTSTRAP) {
    const destPath = path.join(ROOT, ...dest);
    const tplPath = path.join(ROOT, ...tpl);
    if (fs.existsSync(destPath) || !fs.existsSync(tplPath)) continue;
    fs.copyFileSync(tplPath, destPath);
    console.log(
      `${C.db}[env]${C.reset} 📄 ${dest.join("/")} creado desde ${tpl.join("/")} — revisa los valores y secretos`,
    );
  }
}

// ── Arranque de servicios ───────────────────────────────────

function resolveCmd(svc) {
  if (svc.name === "bot") {
    // Se invoca el intérprete del venv directamente en vez de `bash dev.sh`:
    // así funciona igual en Linux/macOS y en Windows (venv en Scripts\).
    const py = path.join(ROOT, svc.dir, PY_VENV_PY);
    if (!fs.existsSync(py)) {
      const base = (PY_BASE || ["python3"]).join(" ");
      console.warn(
        `${C.bot}[bot]${C.reset} ⚠️  bot/.venv no existe — crealo con: ` +
          `${base} -m venv bot/.venv && ${path.join("bot", PY_VENV_PY)} -m pip install -r bot/requirements.txt`,
      );
      return null;
    }
    const base = [py, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"];
    // Dev: uvicorn con --reload; prod: sin él.
    return MODE === "prod" ? base : [...base, "--reload"];
  }
  return MODE === "prod" ? svc.prod : svc.dev;
}

function startService(svc) {
  const color = C[svc.name] || "";
  const lanUrl = svc.lan ? toLanUrl(svc.url, lanIp()) : null;
  console.log(
    `${color}[${svc.name}]${C.reset} ▶ ${svc.url}` +
      (lanUrl ? `  (red local: ${lanUrl})` : "") +
      `  (log: logs/${svc.name}.log)`,
  );

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
    // Cada servicio escucha en SU puerto (`svc.url`), no en el `PORT` del
    // backend que `loadEnvFile` dejó en `process.env` y se heredaría a todos
    // (p. ej. el admin vite terminaba en :3000 y chocaba con el backend).
    env: port ? { ...process.env, PORT: port } : process.env,
  });

  child.on("error", (err) => {
    console.error(`${color}[${svc.name}]${C.reset} ✘ no se pudo arrancar: ${err.message}`);
  });
  child.unref(); // no mantener vivo al padre por el hijo
  fs.closeSync(fd); // el hijo heredó su propio fd al archivo
  return child.pid;
}

/**
 * Deja corriendo la SALIDA Postgres → ERP en bucle (`sync-out.mjs --apply`).
 * Requiere Postgres y Advantage arriba. Registra su pid para `--stop`.
 */
function startErpSync() {
  const script = path.join(ROOT, "scripts-agent", "erp", "sync-out.mjs");
  if (!fs.existsSync(script)) {
    console.warn(
      `${C.advantage}[erp-sync]${C.reset} ⚠️  No existe ${path.relative(ROOT, script)}; se omite.`,
    );
    return null;
  }
  console.log(
    `${C.advantage}[erp-sync]${C.reset} 🔄 salida PG→ERP cada ${ERP_INTERVAL}s (log: logs/erp-sync.log)`,
  );
  const { fd } = openLog("erp-sync");
  const child = spawn("node", [script, "--apply", `--loop=${ERP_INTERVAL}`], {
    cwd: ROOT,
    stdio: ["ignore", fd, fd],
    detached: DETACHED, // POSIX: grupo propio · Windows: sin consola (sin ventana)
    shell: process.platform === "win32",
  });
  child.on("error", (err) => {
    console.error(`${C.advantage}[erp-sync]${C.reset} ✘ no se pudo arrancar: ${err.message}`);
  });
  child.unref();
  fs.closeSync(fd); // el hijo heredó su propio fd al archivo
  return child.pid;
}

/**
 * IPv4 de la red local, para abrir los servicios desde el celular.
 * Se puede forzar con `LAN_IP=192.168.x.x`.
 */
function lanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  // Se descartan las interfaces virtuales (docker, puentes, VPNs): no son
  // alcanzables desde el celular aunque tengan IPv4.
  const virtual = /^(docker|br-|veth|virbr|vmnet|tun|tap|utun|wg)/i;
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      found.push(a.address);
    }
  }
  // Prefiere el rango típico de casa/oficina: 192.168 → 10 → 172.16-31.
  const rank = (ip) =>
    ip.startsWith("192.168.")
      ? 0
      : ip.startsWith("10.")
        ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
          ? 2
          : 3;
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Reemplaza el host localhost de una URL por la IP de la red local. */
function toLanUrl(url, ip) {
  return ip ? url.replace("//localhost", `//${ip}`) : null;
}

/**
 * Dominio comodín que le da un hostname a la IP local. Google exige un origen
 * con dominio (rechaza IPs) para el login, así que el cliente se abre también
 * en `192-168-0-132.sslip.io`, que resuelve a la misma IP.
 */
const LAN_ALIAS_DOMAIN = "sslip.io";

/** Alias con dominio de una IPv4: 192.168.0.132 → 192-168-0-132.sslip.io */
function asLanHostname(ip) {
  return ip ? `${ip.replace(/\./g, "-")}.${LAN_ALIAS_DOMAIN}` : null;
}

function printUrls(services, showDb, showOsrm, showAdvantage) {
  const ip = lanIp();
  console.log("\n━━━━━━━━━━━━━ Mercaldas — URLs ━━━━━━━━━━━━━");
  for (const svc of services) {
    if (!svc.url) continue;
    // Los servicios marcados `lan` escuchan en 0.0.0.0 y resuelven el API en su
    // propio origen: se pueden abrir desde el celular sin tocar nada más.
    const lanUrl = svc.lan ? toLanUrl(svc.url, ip) : null;
    // Además de la IP se muestra el hostname (lo exige Google para el login).
    const host = svc.lan ? asLanHostname(ip) : null;
    console.log(
      `  ${svc.name.toUpperCase().padEnd(8)} → ${svc.url}` +
        (lanUrl ? `   ·  red local: ${lanUrl}` : "") +
        (lanUrl && host
          ? `   ·  host: http://${host}:${new URL(svc.url).port}`
          : ""),
    );
  }
  if (showDb) console.log("  DB             → PostgreSQL localhost:5432 (docker)");
  if (showOsrm) console.log("  OSRM           → Rutas http://localhost:5000 (docker, Manizales)");
  if (showAdvantage)
    console.log(
      `  ADVANTAGE      → ERP ${ADV_URL} (${ADV_EXTERNAL ? "externo" : "docker"}, OpenADS/Studio · ${ADV_HTTP_USER})`,
    );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const started = services.map((s) => s.name).join(", ");
  console.log(`Logs: logs/*.log  (${started || "sin servicios"}).`);

  // Atajo para el celular: es la misma URL que descubre el APK por `/discovery`.
  const lanSvc = services.find((s) => s.lan && s.url);
  const lanUrl = lanSvc ? toLanUrl(lanSvc.url, ip) : null;
  if (lanUrl) {
    console.log(`\n📱 Celular (misma Wi-Fi): abre ${lanUrl}`);
    // El login con Google necesita hostname (no IP): este es el mismo servidor
    // visto con dominio, y el que va en los orígenes autorizados de Google.
    const host = asLanHostname(ip);
    if (host) {
      const port = new URL(lanSvc.url).port;
      console.log(`   Host para el login con Google: http://${host}:${port}`);
    }
    console.log("   El APK cliente lo descubre solo; si cambias de red, vuelve a arrancar.");
  }
}

// ── Apps móviles (Expo Go) ────────────────────────────────────

function ensureExpoDeps(dir, color, label) {
  if (dirHasContent(path.join(dir, "node_modules"))) return true;
  console.log(
    `${color}[${label}]${C.reset} 📦 instalando dependencias (${PM_INSTALLERS.join(" → ")})...`,
  );
  // Se prueban los gestores en orden (pnpm → npm → yarn) hasta que uno funcione.
  for (const pm of PM_INSTALLERS) {
    const r = spawnSync(pm, ["install"], {
      cwd: dir,
      stdio: "inherit",
      timeout: 300000,
      shell: PM_SHELL,
    });
    if (r.status === 0) return true;
    console.warn(
      `${color}[${label}]${C.reset} ⚠️  "${pm} install" falló; probando con el siguiente gestor...`,
    );
  }
  console.error(`${color}[${label}]${C.reset} ✘ falló la instalación de dependencias`);
  return false;
}

/**
 * Arranca una app Expo en FOREGROUND (interactivo, `--fg`): así el QR de Expo Go
 * aparece en esta terminal. Ctrl+C detiene solo esa app; el resto de servicios
 * sigue en background. Solo aplica en modo dev.
 */
function startExpoAppForeground({ dir, port, color, label, title, hints = [], extraArgs = [] }) {
  if (!ensureExpoDeps(dir, color, label)) return null;

  console.log("");
  console.log(
    `${color}📱 ${title}${C.reset} — escanea el QR con **Expo Go** (celular en la MISMA red Wi-Fi).`,
  );
  for (const hint of hints) {
    console.log(`${color}[${label}]${C.reset}   ${hint}`);
  }
  console.log(
    `${color}[${label}]${C.reset}   Ctrl+C aquí detiene SOLO ${label}; lo demás sigue en background.`,
  );
  console.log("");

  const r = spawnSync(PM, ["exec", "expo", "start", ...extraArgs], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
    shell: PM_SHELL,
  });
  if (r.status !== 0) {
    console.warn(
      `${color}[${label}]${C.reset} ⚠️  expo terminó con código ${r.status ?? "?"} — ¿puerto ${port} ocupado? (node dev.js --stop para liberar)`,
    );
  }
  return null; // bloqueó hasta Ctrl+C: no hay pid que registrar
}

/**
 * Arranca una app Expo DESACOPLADA (segundo plano): la salida va a
 * logs/<label>.log, Metro sobrevive al cierre de la terminal y el proceso queda
 * registrado en logs/.pids.json para que `node dev.js --stop` lo detenga.
 *
 * Sin TTY, Expo no dibuja el QR y (SDK 57) solo imprime la URL del dev server
 * fijada a localhost; la URL para Expo Go se compone aquí con la IP de LAN — es
 * la que el celular usa como Host y de la que Metro deriva el manifest.
 */
async function startExpoAppBackground({ dir, port, color, label, title, hints = [], extraArgs = [] }) {
  if (!ensureExpoDeps(dir, color, label)) return null;

  console.log("");
  console.log(`${color}📱 ${title}${C.reset} — Expo Go (celular en la MISMA red Wi-Fi).`);
  for (const hint of hints) {
    console.log(`${color}[${label}]${C.reset}   ${hint}`);
  }

  killPort(port);
  sleepSync(800); // tiempo para que el SO libere el socket

  const { fd } = openLog(label);
  const child = spawn(PM, ["exec", "expo", "start", "--lan", ...extraArgs], {
    cwd: dir,
    stdio: ["ignore", fd, fd],
    detached: DETACHED, // POSIX: grupo propio · Windows: sin consola (sin ventana)
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
    shell: process.platform === "win32",
  });
  child.on("error", (err) => {
    console.error(`${color}[${label}]${C.reset} ✘ no se pudo arrancar: ${err.message}`);
  });
  child.unref();
  fs.closeSync(fd);

  const ip = lanIp();
  const url = `exp://${ip ?? "localhost"}:${port}`;
  console.log(
    `${color}[${label}]${C.reset} ⏳ esperando a Metro (${url})... pueden ser ~1 min en frío.`,
  );
  const up = await waitForPort(port, 90000);
  if (up) {
    console.log(
      `${color}[${label}]${C.reset} ✅ Metro listo → pega ${url} en Expo Go → \"Enter URL manually\"`,
    );
  } else {
    console.warn(
      `${color}[${label}]${C.reset} ⚠️  Metro no respondió en :${port} — revisa logs/${label}.log`,
    );
  }
  if (!ip)
    console.warn(
      `${color}[${label}]${C.reset} ⚠️  No detecté IP de LAN; fuerza LAN_IP=192.168.x.x y vuelve a arrancar.`,
    );
  console.log(`${color}[${label}]${C.reset}   log: logs/${label}.log  (tail -f logs/${label}.log)`);
  return child.pid;
}

/** Devuelve el pid si la app quedó desacoplada; null si corrió en primer plano. */
async function startExpo(name, opts) {
  return FG ? startExpoAppForeground(opts) : startExpoAppBackground(opts);
}

/** Registra un pid suelto (apps Expo) en logs/.pids.json para poder pararlo. */
function registerPid(name, pid) {
  let pids = {};
  try {
    pids = JSON.parse(fs.readFileSync(PIDS_FILE, "utf8"));
  } catch {
    /* sin archivo de pids */
  }
  pids[name] = pid;
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2));
}

async function startDeliveryExpo() {
  return startExpo("delivery", {
    dir: DELIVERY_DIR,
    port: DELIVERY_PORT,
    color: C.delivery,
    label: "delivery",
    title: "DELIVERY APP",
    hints: ["Sin EXPO_PUBLIC_API_URL corre en modo mock (demo / demo1234)."],
  });
}

async function startPickingMobileExpo() {
  return startExpo("picking-mobile", {
    dir: PICKING_MOBILE_DIR,
    port: PICKING_MOBILE_PORT,
    color: C["picking-mobile"],
    label: "picking-mobile",
    title: "PICKING APP",
    hints: [
      "Configura EXPO_PUBLIC_API_URL con la IP de tu máquina (p. ej. http://192.168.x.x:3000).",
      "Sin esa variable usa http://10.0.2.2:3000 (emulador Android).",
    ],
    extraArgs: ["--port", String(PICKING_MOBILE_PORT)],
  });
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
  killPort(DELIVERY_PORT); // red de seguridad si el pid de expo no quedó registrado
  killPort(PICKING_MOBILE_PORT); // red de seguridad si el pid de expo no quedó registrado

  // OSRM corre como contenedor (no como proceso node): se detiene aparte.
  spawnSync("docker", ["compose", "stop"], { cwd: OSRM_DIR, stdio: "ignore" });

  // Advantage (BD del ERP): contenedor propio.
  if (dockerContainerRunning(ADV_CONTAINER)) {
    spawnSync("docker", ["stop", ADV_CONTAINER], { stdio: "ignore" });
    console.log(`⏹  Advantage (${ADV_CONTAINER})`);
  }

  try {
    fs.unlinkSync(PIDS_FILE);
  } catch {
    /* noop */
  }
  console.log("\n💡 La BD (docker) sigue corriendo. Para detenerla: cd db/docker && docker compose stop");
  console.log("   OSRM (rutas): cd delivery-routing && docker compose stop");
}

// ── Ayuda (--help) ─────────────────────────────────────────
const APP_LABELS = {
  backend: "API backend (NestJS)",
  webclient: "Cliente web (servidor del cliente / APK WebView)",
  admin: "Panel admin web",
  "picking-admin": "Picking admin web",
  "delivery-admin": "Delivery admin web",
  bot: "Bot (Python)",
};

/** Flags con los que se puede pedir un aplicativo (--alias). */
function selectorFlags(name) {
  const flags = [];
  for (const [alias, n] of Object.entries(APP_ALIASES)) {
    if (n === name) flags.push("--" + alias);
  }
  // El flag canónico (igual al nombre) primero: --webclient antes que --client.
  return flags.sort((a, b) => Number(b === "--" + name) - Number(a === "--" + name));
}

function helpDeps(name) {
  const deps = (APP_DEPENDS[name] ?? []).map((d) =>
    d === "db" ? "PostgreSQL :5432" : d,
  );
  return deps.length ? "requiere " + deps.join(" + ") : "";
}

/** Orden de los aplicativos en la ayuda y el resumen final. */
const APP_ORDER = [
  "webclient",
  "admin",
  "picking-admin",
  "delivery-admin",
  "backend",
  "bot",
];

function printHelp() {
  const out = [];
  out.push("🧪 Mercaldas launcher — comandos implementados (node dev.js en la raíz)");
  out.push("");
  out.push("USO");
  out.push("  node dev.js                     → SOLO monta los servicios ya instalados (no instala ni compila)");
  out.push("  node dev.js --init              → primer arranque: instala, compila y migra la BD (PostgreSQL)");
  out.push("  node dev.js <flags>             → solo los aplicativos pedidos (+ sus dependencias)");
  out.push("  node dev.js --prod [flags]      → modo producción (requiere builds previos: backend + webs)");
  out.push("  node dev.js --fg                → las apps Expo (delivery/picking) en primer plano con el QR");
  out.push("  node dev.js --no-advantage      → no levantar la BD del ERP (OpenADS/Advantage)");
  out.push("  node dev.js --advantage         → solo PostgreSQL + Advantage/OpenADS + sync ERP (sin webs)");
  out.push("  node dev.js --erp-sync          → deja la salida PG→ERP en bucle (requiere Advantage)");
  out.push("  node dev.js --erp-sync --erp-interval=15  → igual, cada 15 s (def. 30)");
  out.push("  node dev.js --stop              → detiene los servicios levantados por dev.js");
  out.push("  node dev.js --migrate           → restaura la BD desde db/backups/ecommerce y sale");
  out.push("  node dev.js --migrate --force   → ídem, sobrescribiendo una BD con datos");
  out.push("  node dev.js --help              → esta ayuda");
  out.push("");
  out.push("APLICATIVOS (cada uno levanta sus dependencias, ver columna DEP)");
  const order = APP_ORDER;
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
    out.push(
      `  ${r.flags.padEnd(wFlags)}  ${r.label.padEnd(wLabel)}  ${r.url.padEnd(wUrl)}  ${r.deps}`.trimEnd(),
    );
  }
  out.push("");
  out.push("MÓVIL Y RUTAS");
  out.push("  --delivery   App móvil delivery (Expo, :8081)  — levanta backend + OSRM + PostgreSQL");
  out.push("  --picking-mobile  App móvil picking (Expo, :8082) — levanta backend + PostgreSQL");
  out.push("  --osrm       Motor de rutas OSRM (:5000) — Manizales (sin apps)");
  out.push("");
  out.push("APPS EXPO (Metro)");
  out.push("  Por defecto corren DESACOPLADAS: la terminal queda libre (se puede cerrar) y el");
  out.push("  proceso se detiene con --stop. Como no hay TTY, Expo no dibuja el QR: dev.js");
  out.push("  imprime la URL exp://<ip>:<puerto> para pegarla en Expo Go → \"Enter URL manually\".");
  out.push("  Con --fg el QR y los atajos (r, a, j) aparecen en esta terminal, a cambio de");
  out.push("  quedarse ocupada hasta Ctrl+C. Por app: pnpm exec expo start --lan (en su carpeta).");
  out.push("");
  out.push("BASES DE DATOS");
  out.push("  PostgreSQL principal (:5432) se levanta con cualquier app (dependencia del backend).");
  out.push("  Advantage/OpenADS (:18080 Studio · :16262 wire) — BD del ERP de Mercaldas, en Docker.");
  out.push("    Se levanta junto a PostgreSQL (omítela con --no-advantage). Imagen: mercaldas/openads:1.09.73.");
  out.push("    Datos: db/ads/openads/data (copia escribible) o ERP_ADV_DATA=C:/ADD_FORTUNER.");
  out.push("    Con ERP_ADV_EXTERNAL=1 no levanta Docker: usa OPENADS_URL ya existente.");
  out.push("    Detalle: db/ads/openads/README.md y docs/DESPLIEGUE-ERP-FORTUNER.md");
  out.push("  Respaldo versionado: db/backups/ecommerce (troceado) — restaurar: node dev.js --migrate");
  out.push("  Sync ERP (conector scripts-agent/erp): `node dev.js --erp-sync` deja corriendo la salida");
  out.push("    PG→ERP en bucle (push-customers/push-catalog/push-orders/reconcile cada 30 s). Ver docs/RUNBOOK-ERP.md");
  out.push("  Para detenerla:   cd db/docker && docker compose stop");
  out.push("                    cd delivery-routing && docker compose stop  (OSRM)");
  out.push("                    docker stop openads-img                        (Advantage/ERP)");
  out.push("");
  out.push("EJEMPLOS");
  out.push("  node dev.js --delivery-admin    → panel de delivery admin + backend + OSRM + BD (rutas del mapa)");
  out.push("  node dev.js --delivery          → API real (backend + OSRM + BD) y la app delivery (Metro en background)");
  out.push("  node dev.js --picking-mobile    → app picking (Metro en background) + backend + BD");
  out.push("  node dev.js --admin --picking-admin   → combina aplicativos");
  out.push("  node dev.js --prod --delivery-admin");
  out.push("  node dev.js --migrate            → clon nuevo: deja la BD lista desde el respaldo");
  out.push("");
  out.push("Notas: --client es alias de --web · logs en logs/<servicio>.log · PIDs en logs/.pids.json");
  out.push("       URL de red local (celular): se detecta sola; fuerza con LAN_IP=192.168.x.x");
  out.push("       Un flag desconocido no ejecuta nada (aborta; usa --help para ver las opciones).");
  console.log(out.join("\n"));
}

/** Resumen final tras levantar: todas las formas de invocar el lanzador. */
function printCommands() {
  const extraLabels = {
    delivery: "App móvil delivery (Expo, :8081)",
    "picking-mobile": "App móvil picking (Expo, :8082)",
    osrm: "Motor de rutas OSRM (:5000)",
  };
  const rows = [["node dev.js", "levanta TODO (BDs + backend + webs + bot + OSRM + delivery)"]];
  for (const name of [...APP_ORDER, "delivery", "picking-mobile", "osrm"]) {
    const svc = SERVICES.find((s) => s.name === name);
    const label = APP_LABELS[name] ?? extraLabels[name] ?? name;
    rows.push([`node dev.js --${name}`, `${label}${svc?.url ? ` (${svc.url})` : ""}`]);
  }
  rows.push(["node dev.js --all", "todo (explícito)"]);
  rows.push(["node dev.js --prod", "modo producción (requiere builds previos)"]);
  rows.push(["node dev.js --fg", "apps Expo con el QR en la terminal (bloquea)"]);
  rows.push(["node dev.js --stop", "detiene los servicios levantados por dev.js"]);
  rows.push(["node dev.js --init", "primer arranque: instala + compila + migra la BD (PostgreSQL)"]);
  rows.push(["node dev.js --migrate", "restaura la BD desde db/backups/ecommerce"]);
  rows.push(["node dev.js --no-advantage", "no levantar la BD del ERP (OpenADS)"]);
  rows.push(["node dev.js --advantage", "solo PostgreSQL + Advantage/OpenADS + sync ERP"]);
  rows.push(["node dev.js --erp-sync", "deja la salida PG→ERP en bucle (requiere Advantage)"]);
  rows.push(["node dev.js --help", "esta ayuda"]);

  const w = Math.max(...rows.map((r) => r[0].length));
  console.log("Comandos útiles:");
  for (const [cmd, desc] of rows) console.log(`  ${cmd.padEnd(w)}  → ${desc}`);
  console.log("");
  console.log("Bases de datos (docker compose stop):");
  console.log("  cd db/docker            → PostgreSQL :5432");
  console.log("  cd delivery-routing     → OSRM :5000");
  console.log("  docker stop openads-img → Advantage/OpenADS :18080 (ERP)");
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  if (HELP) {
    printHelp();
    return;
  }
  // Flag desconocido ⇒ no se ejecuta nada (antes se interpretaba como "todo").
  const unknown = unknownFlags();
  if (unknown.length) {
    console.error(`✘ Flag(s) desconocido(s): ${unknown.join(", ")} — no se levanta nada.`);
    console.error("  Usa `node dev.js --help` para ver las opciones.");
    process.exit(1);
  }
  if (STOP) return stopAll();
  // `--migrate`: tarea puntual (deja la BD restaurada) y salir.
  if (MIGRATE) process.exit(await runMigrate());

  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const plan = resolveSelection(); // null ⇒ todo
  // `--advantage` solo (sin otros aplicativos) ⇒ únicamente BDs + sync ERP.
  const onlyAdvantage =
    ADVANTAGE &&
    !ARGS.some((a) => {
      if (!a.startsWith("--")) return false;
      const k = a.toLowerCase().split("=")[0].slice(2);
      return APP_ALIASES[k] !== undefined;
    });
  const effectivePlan = onlyAdvantage ? ["db"] : plan;
  const wantDb = effectivePlan === null || effectivePlan.includes("db");
  const wantOsrm = effectivePlan === null || effectivePlan.includes("osrm");
  // Advantage (BD del ERP, OpenADS) acompaña a PostgreSQL; `--no-advantage` lo omite.
  const wantAdvantage = wantDb && !NO_ADVANTAGE;
  const svcNames =
    effectivePlan === null
      ? SERVICES.map((s) => s.name)
      : effectivePlan.filter((n) => n !== "db" && n !== "osrm");
  const services = SERVICES.filter((s) => svcNames.includes(s.name));
  const wantDelivery = effectivePlan === null || effectivePlan.includes("delivery");
  // La picking app (Expo) solo se lanza cuando se pide explícitamente: en
  // `node dev.js` (todo) ya hay un Expo interactivo (delivery) y ambos compiten
  // por la terminal.
  const wantPickingMobile = effectivePlan !== null && effectivePlan.includes("picking-mobile");

  console.log(
    `🧪 Mercaldas — modo ${MODE.toUpperCase()} · selección: ${onlyAdvantage ? "Advantage/ERP" : selectionLabel(plan)}  (logs → logs/*.log)`,
  );
  if (PM === "npm")
    console.warn(
      `${C.bot}[pnpm]${C.reset} ⚠️  pnpm no está instalado — se usará npm como gestor de paquetes en los fronts.`,
    );
  console.log("");

  // Por defecto `node dev.js` SOLO monta los servicios (no instala, no compila
  // ni migra la BD). El primer arranque desde cero se hace con `--init`.
  const sinDeps = new Set();
  if (INIT) {
    console.log(`🧱 --init: primer arranque → instalando dependencias y compilando...\n`);
    ensureEnvFiles();
    for (const svc of services) {
      if (!ensureDeps(svc)) sinDeps.add(svc.name);
    }
    for (const svc of services) {
      if (!sinDeps.has(svc.name)) buildService(svc);
    }
    console.log("");
  } else {
    console.log(
      `ℹ️  Se montan los servicios ya instalados (primer arranque desde cero: node dev.js --init).\n`,
    );
  }

  if (wantDb || wantOsrm || wantAdvantage) {
    await ensureDocker();
  }

  if (wantDb) {
    startDatabase();
    const dbUp = await waitForPort(5432, 90000);
    if (!dbUp) {
      console.warn(
        `${C.db}[db]${C.reset} ⚠️  PostgreSQL no responde en :5432; los servicios reintentarán al conectar.`,
      );
    } else if (INIT) {
      // Primer arranque: monta el respaldo versionado en PostgreSQL (solo la BD).
      restoreDatabaseIfNeeded({ force: FORCE, explicit: true });
    } else {
      console.log(
        `${C.db}[db]${C.reset} ℹ️  Sin --init no se migra la BD (usa --init, o node dev.js --migrate).`,
      );
    }
  }
  if (!wantDb)
    console.log(`${C.db}[db]${C.reset} 🚫 PostgreSQL no iniciado (esta selección no lo necesita).`);

  if (wantAdvantage) {
    const up = ADV_EXTERNAL
      ? startAdvantage() && (await waitForOpenAds(ADV_URL, 90000))
      : startAdvantage() && (await waitForPort(ADV_HTTP_PORT, 90000));
    if (!up) {
      console.warn(
        `${C.advantage}[adv]${C.reset} ⚠️  Advantage no responde en ${ADV_EXTERNAL ? ADV_URL : `:${ADV_HTTP_PORT}`}.`,
      );
    }
  }

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

  // Salida Postgres → ERP en bucle: con --erp-sync o --advantage (necesita Advantage).
  if (ERP_SYNC || ADVANTAGE) {
    if (!wantAdvantage && !ADV_EXTERNAL) {
      console.warn(
        `${C.advantage}[erp-sync]${C.reset} ⚠️  --erp-sync necesita Advantage; se omite (--no-advantage).`,
      );
    } else {
      const pid = startErpSync();
      if (pid) registerPid("erp-sync", pid);
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

  printUrls(services, wantDb, wantOsrm, wantAdvantage);

  if (MODE === "dev") {
    if (wantDelivery) {
      console.log(
        "\n✅ Servicios levantados (background). Ahora el delivery app:",
      );
      const pid = await startDeliveryExpo();
      if (pid) registerPid("delivery-expo", pid);
      else
        console.log(
          "\n⏹ Delivery detenido. El resto de servicios sigue corriendo.",
        );
    }
    if (wantPickingMobile) {
      console.log(
        "\n✅ Servicios levantados (background). Ahora la picking app:",
      );
      const pid = await startPickingMobileExpo();
      if (pid) registerPid("picking-mobile-expo", pid);
      else
        console.log(
          "\n⏹ Picking app detenida. El resto de servicios sigue corriendo.",
        );
    }
    if (!wantDelivery && !wantPickingMobile) {
      console.log(
        "\n✅ Listo — esta selección no incluye apps móviles (agrega --delivery o --picking-mobile). Terminal libre.",
      );
    }
  } else {
    console.log("\n✅ Todo levantado. Terminal libre.");
    if (wantDelivery)
      console.log(
        "   Delivery en --prod: corre desde el APK/dev build (carpeta android/), no usa Expo Go.",
      );
    if (wantPickingMobile)
      console.log(
        "   Picking app en --prod: corre desde el APK/dev build (carpeta android/), no usa Expo Go.",
      );
  }

  console.log("");
  printCommands();
  if (!FG && (wantDelivery || wantPickingMobile))
    console.log(
      "\n💡 Metro corre desacoplado: puedes cerrar esta terminal. Para detenerlo todo: node dev.js --stop",
    );
  process.exit(0); // cierra el script; los servicios siguen en segundo plano
}

if (require.main === module) {
  main();
}

// Exportado solo para pruebas (dev.js se ejecuta como script).
module.exports = { startAdvantage, ensureAdvantageData };
