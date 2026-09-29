#!/usr/bin/env node
/**
 * Mercaldas — lanzador de servicios.
 *
 * Uso:
 *   node dev.js            # DEV: instala dependencias faltantes, levanta
 *                          #   PostgreSQL + los servicios (y las apps Expo) en
 *                          #   segundo plano, espera a que el backend esté listo,
 *                          #   imprime las URLs y termina (la terminal queda
 *                          #   libre: se puede cerrar sin matar Metro).
 *   node dev.js <flags>    # Solo los aplicativos pedidos (p. ej. --delivery-admin).
 *   node dev.js --fg       # Las apps Expo (delivery/picking) se quedan en
 *                          #   primer plano mostrando el QR (bloquea la terminal).
 *   node dev.js --prod     # PRODUCCIÓN ("en vivo"): comandos de producción.
 *                          #   Requiere builds previos (backend: npm run build,
 *                          #   webs: npm run build). Los logs quedan en logs/*.log.
 *   node dev.js --stop     # Detiene los servicios levantados por dev.js.
 *   node dev.js --help     # Lista todos los comandos implementados.
 *
 * Logs: un archivo por servicio en logs/ (logs/<servicio>.log).
 *
 * La BD (docker) queda corriendo al salir; se detiene con
 * `cd db/docker && docker compose stop`.
 */
const { spawn, spawnSync } = require("node:child_process");
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

// BD principal (db/docker/docker-compose.yml) y respaldo versionado en db/backup.
// El respaldo va troceado (ecommerce.dump.part-000, ...) para subirlo a GitHub.
const DB_CONTAINER = "ecommerce_postgres";
const DB_NAME = "ecommerce";
const DB_BACKUP_DIR = path.join(ROOT, "db", "backup");

// BD de analytics (db-campaigns/docker-compose.yml) y su respaldo en db-campaigns/backups.
const CAMPAIGNS_DIR = path.join(ROOT, "db-campaigns");
const CAMPAIGNS_CONTAINER = "analytics_postgres";
const CAMPAIGNS_DB = "analytics";
const CAMPAIGNS_BACKUP_DIR = path.join(CAMPAIGNS_DIR, "backups");

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes("--prod") || ARGS.includes("--live") ? "prod" : "dev";
const STOP = ARGS.includes("--stop");
const HELP = ARGS.includes("--help");
// Las apps móviles (Expo) corren desacopladas por defecto: así la terminal queda
// libre y se puede cerrar sin matar Metro. Con --fg se muestra el QR aquí mismo.
const FG = ARGS.includes("--fg") || ARGS.includes("--foreground");
// Restaura la copia de datos de analytics (db-campaigns) desde el respaldo
// versionado y sale. Acepta también el alias mal escrito `--migration-campaings`.
const MIGRATION_CAMPAIGNS =
  ARGS.includes("--migration-campaigns") || ARGS.includes("--migration-campaings");

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
const PYTHON_DEPS = {
  marker: [".venv", "bin", "python"],
  markerType: "file",
  install: [
    ["python3", "-m", "venv", ".venv"],
    [".venv", "bin", "pip", "install", "-r", "requirements.txt"],
  ],
};

function hasBin(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: PM_SHELL });
  return r.status === 0;
}

const C = {
  db: "\x1b[36m",
  backend: "\x1b[31m",
  web: "\x1b[32m",
  webclient: "\x1b[36m",
  admin: "\x1b[34m",
  analytics: "\x1b[96m",
  picking: "\x1b[95m",
  "picking-admin": "\x1b[91m",
  "delivery-admin": "\x1b[93m",
  bot: "\x1b[35m",
  ia: "\x1b[33m",
  delivery: "\x1b[92m",
  "picking-mobile": "\x1b[94m",
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
    // Sirve el build de `Interface web client/dist` y hace de mismo-origen del
    // API; es lo que embebe el APK cliente (WebView) y lo que este descubre en
    // la red local (`GET /discovery`).
    name: "webclient",
    dir: ".",
    url: "http://localhost:4173",
    dev: ["node", "scripts-agent/serve-webclient.mjs", "4173"],
    prod: ["node", "scripts-agent/serve-webclient.mjs", "4173"],
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
    // Vite escucha en 0.0.0.0 y el backend acepta orígenes de la red local, así
    // que el panel se puede abrir desde el celular con la IP del equipo. El
    // cliente resuelve el API contra el host que sirvió la página
    // (`resolveApiBaseUrl` en `Interface web admin/src/lib/api.ts`).
    lan: true,
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
// para que funcione (p. ej. --analytics ⇒ backend + PostgreSQL de campañas + ia-service).
const APP_ALIASES = {
  client: "webclient",
  webclient: "webclient",
  "client-apk": "webclient",
  backend: "backend",
  admin: "admin",
  analytics: "analytics",
  ia: "ia",
  picking: "picking",
  "picking-admin": "picking-admin",
  "delivery-admin": "delivery-admin",
  bot: "bot",
  delivery: "delivery",
  "picking-mobile": "picking-mobile",
  "movil-picking": "picking-mobile",
  osrm: "osrm",
};

const APP_DEPENDS = {
  // db-campaigns (PostgreSQL de analytics, :5436) solo lo necesita el panel
  // de analytics; el backend de ecommerce usa únicamente la BD principal (:5432).
  backend: ["db"],
  webclient: ["backend"], // sirve la web del cliente (APK/WebView) y proxy del API
  admin: ["backend"],
  analytics: ["backend", "db-campaigns", "ia"], // panel analytics + BD de campañas + ia-service (contenido)
  picking: ["backend"],
  "picking-admin": ["backend"],
  "delivery-admin": ["backend"],
  bot: ["backend"],
  ia: ["backend"], // genera contenido vía el backend; no usa la BD de campañas
  delivery: ["backend", "osrm"], // API real: backend (+BD) + OSRM para rutas
  "picking-mobile": ["backend"], // app móvil de picking (Expo, QR)
  osrm: [],
};

const NO_SELECTOR_FLAGS = new Set([
  "--prod",
  "--live",
  "--stop",
  "--help",
  "--all",
  "--fg",
  "--foreground",
  "--migration-campaigns",
  "--migration-campaings",
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

// ── Restauración del respaldo versionado (db/backup) ────────
// Antes de la primera migración la BD local solo tiene las extensiones de
// init.sql (PostGIS, citext, ...). Si no existe la tabla `products` se asume un
// clon nuevo y se reensambla el respaldo (part-000, part-001, ...) para
// restaurarlo con pg_restore. Si ya hay datos, no se toca nada.
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

function loadBackup() {
  if (!fs.existsSync(DB_BACKUP_DIR)) return null;
  const files = fs.readdirSync(DB_BACKUP_DIR);
  const single = files.includes("ecommerce.dump");
  const parts = files
    .filter((f) => /^ecommerce\.dump\.part-\d+$/.test(f))
    .sort();
  if (!single && parts.length === 0) return null;
  const names = single ? ["ecommerce.dump"] : parts;
  const buffer = Buffer.concat(
    names.map((n) => fs.readFileSync(path.join(DB_BACKUP_DIR, n))),
  );
  return { names, buffer };
}

function restoreDatabaseIfNeeded() {
  const backup = loadBackup();
  if (!backup) return;

  const initialized = dbIsInitialized();
  if (initialized === null) {
    console.warn(
      `${C.db}[db]${C.reset} ⚠️  No se pudo verificar el estado de la BD; se omite la restauración del respaldo.`,
    );
    return;
  }
  if (initialized) return; // ya tiene datos: no se sobrescribe

  // Integridad: si existe el hash del volcado completo, se valida antes de restaurar.
  const shaFile = path.join(DB_BACKUP_DIR, "ecommerce.dump.sha256");
  if (fs.existsSync(shaFile)) {
    const expected = fs.readFileSync(shaFile, "utf8").trim();
    const actual = crypto.createHash("sha256").update(backup.buffer).digest("hex");
    if (expected && expected !== actual) {
      console.error(
        `${C.db}[db]${C.reset} ✘ El respaldo no coincide con su hash (esperado ${expected.slice(0, 12)}…, obtenido ${actual.slice(0, 12)}…). Se omite la restauración.`,
      );
      return;
    }
  }

  const mb = (backup.buffer.length / (1024 * 1024)).toFixed(1);
  console.log(
    `${C.db}[db]${C.reset} 📥 BD vacía: restaurando respaldo (${backup.names.length} archivo(s), ${mb} MB)...`,
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
  } else {
    console.warn(
      `${C.db}[db]${C.reset} ⚠️  La restauración del respaldo falló (código ${status}; detalle en logs/db.log).`,
    );
  }
}

// ── Restauración de la copia de datos de analytics (db-campaigns/backups) ────
// El respaldo va troceado (analytics_<fecha>.backup.part-000, ...) para subirlo a
// GitHub; si no hay volcado completo se reensamblan las partes y se valida el
// sha256 del volcado completo antes de restaurar.
function loadCampaignsBackup() {
  if (!fs.existsSync(CAMPAIGNS_BACKUP_DIR)) return null;
  const files = fs.readdirSync(CAMPAIGNS_BACKUP_DIR);
  const singles = files.filter((f) => /^analytics_.*\.backup$/.test(f)).sort();
  const parts = files
    .filter((f) => /^analytics_.*\.backup\.part-\d+$/.test(f))
    .sort();
  if (singles.length === 0 && parts.length === 0) return null;

  let names;
  let stem;
  if (singles.length) {
    // Más reciente por nombre (la fecha ISO ordena lexicográficamente).
    const single = singles[singles.length - 1];
    names = [single];
    stem = single.replace(/\.backup$/, "");
  } else {
    names = parts;
    stem = parts[0].replace(/\.backup\.part-\d+$/, "");
  }
  const buffer = Buffer.concat(
    names.map((n) => fs.readFileSync(path.join(CAMPAIGNS_BACKUP_DIR, n))),
  );
  return {
    names,
    buffer,
    shaFile: path.join(CAMPAIGNS_BACKUP_DIR, `${stem}.backup.sha256`),
  };
}

/** Restaura la copia de datos de analytics. Sobrescribe la BD `analytics`. */
function restoreCampaignsDatabase() {
  const backup = loadCampaignsBackup();
  if (!backup) {
    console.warn(
      `${C.db}[db-campaigns]${C.reset} ⚠️  No hay respaldo en db-campaigns/backups/ (nada que restaurar).`,
    );
    return false;
  }

  // Integridad: sha256 del volcado completo (reensamblado).
  if (fs.existsSync(backup.shaFile)) {
    const expected = fs.readFileSync(backup.shaFile, "utf8").trim().split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(backup.buffer).digest("hex");
    if (expected && expected !== actual) {
      console.error(
        `${C.db}[db-campaigns]${C.reset} ✘ El respaldo no coincide con su hash (esperado ${expected.slice(0, 12)}…, obtenido ${actual.slice(0, 12)}…). Se omite.`,
      );
      return false;
    }
  }

  const mb = (backup.buffer.length / (1024 * 1024)).toFixed(1);
  console.log(
    `${C.db}[db-campaigns]${C.reset} 📥 Restaurando copia de datos (${backup.names.length} archivo(s), ${mb} MB)...`,
  );

  // Igual que el respaldo del ecommerce: se escribe a un temporal y se copia al
  // contenedor con `docker cp` (evita tuberías binarias por stdin).
  const relTmp = "logs/analytics_restore.dump";
  const hostTmp = path.join(ROOT, "logs", "analytics_restore.dump");
  const containerTmp = "/tmp/analytics_restore.dump";
  const { fd } = openLog("db");
  let status = 1;
  try {
    fs.writeFileSync(hostTmp, backup.buffer);
    const cp = spawnSync(
      "docker",
      ["cp", relTmp, `${CAMPAIGNS_CONTAINER}:${containerTmp}`],
      { cwd: ROOT, stdio: ["ignore", fd, fd], timeout: 300000 },
    );
    if (cp.status === 0) {
      const r = spawnSync(
        "docker",
        [
          "exec", CAMPAIGNS_CONTAINER,
          "pg_restore", "-U", "postgres", "-d", CAMPAIGNS_DB,
          "-j", "4", "--clean", "--if-exists", "--no-owner", "--no-privileges",
          containerTmp,
        ],
        { stdio: ["ignore", fd, fd], timeout: 900000 },
      );
      status = r.status;
      spawnSync("docker", ["exec", CAMPAIGNS_CONTAINER, "rm", "-f", containerTmp], {
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
    const chk = spawnSync(
      "docker",
      [
        "exec", CAMPAIGNS_CONTAINER,
        "psql", "-U", "postgres", "-d", CAMPAIGNS_DB, "-tAc",
        "SELECT 'vw_rfm_clientes=' || count(*) FROM analytics.vw_rfm_clientes UNION ALL SELECT 'cliente_segmento=' || count(*) FROM analytics.cliente_segmento UNION ALL SELECT 'pos.venta_lineas=' || count(*) FROM pos.venta_lineas",
      ],
      { encoding: "utf8" },
    );
    const counts = (chk.stdout || "").trim().split("\n").filter(Boolean).join(" ");
    console.log(`${C.db}[db-campaigns]${C.reset} ✅ Copia restaurada${counts ? " — " + counts : ""}`);
    return true;
  }
  console.warn(
    `${C.db}[db-campaigns]${C.reset} ⚠️  La restauración de la copia falló (código ${status}; detalle en logs/db.log).`,
  );
  return false;
}

/** `node dev.js --migration-campaigns`: levanta db-campaigns, restaura la copia y sale. */
async function migrateCampaigns() {
  console.log("🧪 Mercaldas — restaurar la copia de datos de analytics (db-campaigns)");
  const started = startDatabaseCampaigns();
  const up = started && (await waitForPort(5436, 90000));
  if (!up) {
    console.warn(
      `${C.db}[db-campaigns]${C.reset} ⚠️  db-campaigns no responde en :5436; no se puede restaurar.`,
    );
    process.exit(1);
  }
  const ok = restoreCampaignsDatabase();
  process.exit(ok ? 0 : 1);
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

function printUrls(services, showDb, showCampaigns, showOsrm) {
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
  if (showCampaigns) console.log("  DB-CAMPAIGNS   → PostgreSQL localhost:5436 (docker, analytics)");
  if (showOsrm) console.log("  OSRM           → Rutas http://localhost:5000 (docker, Manizales)");
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
    detached: true, // su propio grupo: sobrevive al cierre de la terminal
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

  try {
    fs.unlinkSync(PIDS_FILE);
  } catch {
    /* noop */
  }
  console.log("\n💡 La BD (docker) sigue corriendo. Para detenerla: cd db/docker && docker compose stop");
  console.log("   La BD de analytics (campañas): cd db-campaigns && docker compose stop");
  console.log("   OSRM (rutas): cd delivery-routing && docker compose stop");
}

// ── Ayuda (--help) ─────────────────────────────────────────
const APP_LABELS = {
  backend: "API backend (NestJS)",
  webclient: "Cliente web (servidor del cliente / APK WebView)",
  admin: "Panel admin web",
  analytics: "Panel analytics web",
  picking: "Picking web",
  "picking-admin": "Picking admin web",
  "delivery-admin": "Delivery admin web",
  bot: "Bot (Python)",
  ia: "Servicio IA (Python)",
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
    d === "db"
      ? "PostgreSQL :5432"
      : d === "db-campaigns"
        ? "db-campaigns :5436"
        : d,
  );
  return deps.length ? "requiere " + deps.join(" + ") : "";
}

/** Orden de los aplicativos en la ayuda y el resumen final. */
const APP_ORDER = [
  "webclient",
  "admin",
  "analytics",
  "picking",
  "picking-admin",
  "delivery-admin",
  "backend",
  "bot",
  "ia",
];

function printHelp() {
  const out = [];
  out.push("🧪 Mercaldas launcher — comandos implementados (node dev.js en la raíz)");
  out.push("");
  out.push("USO");
  out.push("  node dev.js                     → levanta TODO (BDs + backend + todos los web + bot + IA + OSRM + delivery)");
  out.push("  node dev.js <flags>             → solo los aplicativos pedidos (+ sus dependencias)");
  out.push("  node dev.js --prod [flags]      → modo producción (requiere builds previos: backend + webs)");
  out.push("  node dev.js --fg                → las apps Expo (delivery/picking) en primer plano con el QR");
  out.push("  node dev.js --migration-campaigns → restaura la copia de datos de analytics (db-campaigns) y sale");
  out.push("  node dev.js --stop              → detiene los servicios levantados por dev.js");
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
  out.push("  db-campaigns (:5436) solo se monta con --analytics o sin flags (todo).");
  out.push("  Para detenerlas:  cd db/docker && docker compose stop");
  out.push("                     cd db-campaigns && docker compose stop");
  out.push("                     cd delivery-routing && docker compose stop  (OSRM)");
  out.push("");
  out.push("EJEMPLOS");
  out.push("  node dev.js --delivery-admin    → panel de delivery admin + backend + BD");
  out.push("  node dev.js --analytics         → analytics + backend + BDs (incluye db-campaigns :5436)");
  out.push("  node dev.js --delivery          → API real (backend + OSRM + BD) y la app delivery (Metro en background)");
  out.push("  node dev.js --picking-mobile    → app picking (Metro en background) + backend + BD");
  out.push("  node dev.js --admin --picking   → combina aplicativos");
  out.push("  node dev.js --prod --delivery-admin");
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
  const rows = [["node dev.js", "levanta TODO (BDs + backend + webs + bot + IA + OSRM + delivery)"]];
  for (const name of [...APP_ORDER, "delivery", "picking-mobile", "osrm"]) {
    const svc = SERVICES.find((s) => s.name === name);
    const label = APP_LABELS[name] ?? extraLabels[name] ?? name;
    rows.push([`node dev.js --${name}`, `${label}${svc?.url ? ` (${svc.url})` : ""}`]);
  }
  rows.push(["node dev.js --all", "todo (explícito)"]);
  rows.push(["node dev.js --prod", "modo producción (requiere builds previos)"]);
  rows.push(["node dev.js --fg", "apps Expo con el QR en la terminal (bloquea)"]);
  rows.push(["node dev.js --migration-campaigns", "restaura la copia de datos de analytics (db-campaigns) y sale"]);
  rows.push(["node dev.js --stop", "detiene los servicios levantados por dev.js"]);
  rows.push(["node dev.js --help", "esta ayuda"]);

  const w = Math.max(...rows.map((r) => r[0].length));
  console.log("Comandos útiles:");
  for (const [cmd, desc] of rows) console.log(`  ${cmd.padEnd(w)}  → ${desc}`);
  console.log("");
  console.log("Bases de datos (docker compose stop):");
  console.log("  cd db/docker            → PostgreSQL :5432");
  console.log("  cd db-campaigns         → analytics :5436");
  console.log("  cd delivery-routing     → OSRM :5000");
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

  fs.mkdirSync(LOGS_DIR, { recursive: true });

  // Tarea de mantenimiento: restaura la copia de datos de analytics y sale.
  if (MIGRATION_CAMPAIGNS) return migrateCampaigns();

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
  // La picking app (Expo) solo se lanza cuando se pide explícitamente: en
  // `node dev.js` (todo) ya hay un Expo interactivo (delivery) y ambos compiten
  // por la terminal.
  const wantPickingMobile = plan !== null && plan.includes("picking-mobile");

  console.log(
    `🧪 Mercaldas — modo ${MODE.toUpperCase()} · selección: ${selectionLabel(plan)}  (logs → logs/*.log)`,
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
    if (!dbUp) {
      console.warn(
        `${C.db}[db]${C.reset} ⚠️  PostgreSQL no responde en :5432; los servicios reintentarán al conectar.`,
      );
    } else {
      // Clon nuevo (BD sin tabla `products`): monta el respaldo de db/backup.
      restoreDatabaseIfNeeded();
    }
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

main();
