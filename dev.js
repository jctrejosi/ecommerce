#!/usr/bin/env node
/**
 * MercAldas — lanzador de servicios.
 *
 * Uso:
 *   node dev.js            # DEV: levanta PostgreSQL + los 4 servicios en
 *                          #   segundo plano, imprime las URLs y termina
 *                          #   (la terminal queda libre para cerrarla).
 *   node dev.js --prod     # PRODUCCIÓN ("en vivo"): comandos de producción.
 *                          #   Requiere builds previos (backend: yarn build,
 *                          #   webs: yarn build). Los logs quedan en logs/*.log.
 *   node dev.js --stop     # Detiene los servicios levantados por dev.js.
 *   node dev.js --help     # Esta ayuda.
 *
 * Logs: un archivo por servicio en logs/
 *   logs/db.log  logs/backend.log  logs/web.log  logs/admin.log  logs/bot.log
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

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes("--prod") || ARGS.includes("--live") ? "prod" : "dev";
const STOP = ARGS.includes("--stop");
const HELP = ARGS.includes("--help");

const C = {
  db: "\x1b[36m",
  backend: "\x1b[31m",
  web: "\x1b[32m",
  admin: "\x1b[34m",
  bot: "\x1b[35m",
  reset: "\x1b[0m",
};

const SERVICES = [
  {
    name: "backend",
    dir: "backend",
    url: "http://localhost:3000",
    dev: ["yarn", "dev"],
    prod: ["yarn", "start:prod"],
  },
  {
    name: "web",
    dir: "Interfaz web client",
    url: "http://localhost:5173",
    dev: ["yarn", "dev"],
    prod: ["yarn", "vite", "preview"],
  },
  {
    name: "admin",
    dir: "Interfaz web admin",
    url: "http://localhost:8443",
    dev: ["yarn", "dev"],
    prod: ["yarn", "preview"],
  },
  {
    name: "bot",
    dir: "bot",
    url: "http://localhost:8000",
    dev: ["bash", "dev.sh"],
    prod: null, // se resuelve en resolveBotProd()
  },
];

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
  console.warn(`${C.db}[db]${C.reset} ⚠️  No se pudo levantar PostgreSQL (detalle en logs/db.log).`);
  return false;
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

function printUrls() {
  console.log("\n━━━━━━━━━━━━━ MercAldas — URLs ━━━━━━━━━━━━━");
  for (const svc of SERVICES) {
    if (!svc.url) continue;
    console.log(`  ${svc.name.toUpperCase().padEnd(8)} → ${svc.url}`);
  }
  console.log("  DB        → PostgreSQL localhost:5432 (docker)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Logs: logs/*.log  (db, backend, web, admin, bot)");
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

  try {
    fs.unlinkSync(PIDS_FILE);
  } catch {
    /* noop */
  }
  console.log("\n💡 La BD (docker) sigue corriendo. Para detenerla: cd db/docker && docker compose stop");
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  if (HELP) {
    console.log(
      "MercAldas launcher\n" +
        "  node dev.js            → dev (logs en logs/*.log, terminal libre)\n" +
        "  node dev.js --prod     → producción (requiere builds previos)\n" +
        "  node dev.js --stop     → detiene los servicios\n",
    );
    return;
  }
  if (STOP) return stopAll();

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  console.log(`🧪 MercAldas — modo ${MODE.toUpperCase()}  (logs → logs/*.log)`);
  console.log("");

  startDatabase();
  const dbUp = await waitForPort(5432, 90000);
  if (!dbUp)
    console.warn(
      `${C.db}[db]${C.reset} ⚠️  PostgreSQL no responde en :5432; los servicios reintentarán al conectar.`,
    );

  const pids = {};
  for (const svc of SERVICES) {
    const pid = startService(svc);
    if (pid) pids[svc.name] = pid;
  }
  fs.writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2));

  printUrls();
  console.log("\n✅ Todo levantado. Esta terminal queda libre — puedes cerrarla.");
  console.log(`   Para detener los servicios más tarde: node dev.js --stop`);
  process.exit(0); // cierra el script; los servicios siguen en segundo plano
}

main();
