#!/usr/bin/env node
/**
 * Levanta el entorno completo de MercAldas en local:
 *   1. Base de datos PostgreSQL (docker compose up -d en db/docker)
 *   2. Los 4 servicios: backend, web client, admin y bot de compras
 *
 * Uso: node dev-all.js   (o: ./dev-all.js en bash)   —  Ctrl+C detiene los servicios.
 * La BD queda corriendo al salir (se detiene con `docker compose stop` en db/docker).
 *
 * Antes de arrancar cada servicio libera su puerto (mata procesos previos),
 * evitando errores de EADDRINUSE / "address already in use".
 */
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const ROOT = __dirname;

const SERVICES = [
  { name: "BACKEND", dir: "backend", url: "http://localhost:3000" },
  { name: "WEB", dir: "Interfaz web client", url: "http://localhost:5173" },
  { name: "ADMIN", dir: "Interfaz web admin", url: "http://localhost:8443" },
  { name: "BOT", dir: "bot", url: "http://localhost:8000", cmd: ["bash", "dev.sh"] },
];

const COLORS = {
  DB: "\x1b[36m",
  BACKEND: "\x1b[31m",
  WEB: "\x1b[32m",
  ADMIN: "\x1b[34m",
  BOT: "\x1b[35m",
  RESET: "\x1b[0m",
};

const children = [];

// ── Base de datos (Docker) ──────────────────────────────────

function startDatabase() {
  const dbDir = path.join(ROOT, "db", "docker");
  const dbPrefix = `${COLORS.DB}[DB]${COLORS.RESET} `;
  console.log(`${dbPrefix}🐘 Levantando PostgreSQL local (docker compose up -d)...`);

  // Intento con --wait (espera el healthcheck de pg_isready).
  // Si el flag no está soportado, cae al arranque simple + espera de puerto.
  const r = spawnSync("docker", ["compose", "up", "-d", "--wait"], {
    cwd: dbDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120000,
  });
  if (r.status === 0) {
    console.log(`${dbPrefix}✅ PostgreSQL listo (db/docker)`);
    return true;
  }

  const r2 = spawnSync("docker", ["compose", "up", "-d"], {
    cwd: dbDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120000,
  });
  if (r2.status === 0) {
    console.log(`${dbPrefix}✅ Contenedor arrancado. Esperando conexiones en :5432...`);
    return true;
  }

  console.warn(`${dbPrefix}⚠️  No se pudo levantar PostgreSQL:`);
  console.warn((r2.stdout || "").trim());
  console.warn((r2.stderr || "").trim());
  console.warn(`${dbPrefix}   → Verifica que Docker esté corriendo (docker info).`);
  return false;
}

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

// ── Liberación de puertos ──────────────────────────────────

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/**
 * Mata el proceso que esté escuchando en `port`.
 * - Unix:  fuser -k <port>/tcp
 * - Windows: netstat + taskkill /F
 */
function killPort(port) {
  if (process.platform === "win32") {
    try {
      const out = spawnSync("netstat", ["-ano"], {
        encoding: "utf8",
      }).stdout;
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

// ── Arranque de servicios ──────────────────────────────────

function start(service) {
  const { name, dir, url, cmd } = service;
  const cwd = path.join(ROOT, dir);
  const color = COLORS[name] || "";
  const port = new URL(url).port;

  console.log(`${color}[${name}]${COLORS.RESET} ▶ ${url}  (cwd: ${cwd})`);

  // Liberar el puerto antes de levantar (evita EADDRINUSE)
  killPort(port);
  sleepSync(800); // dar tiempo a que el SO libere el socket

  const child = spawn(
    cmd ? cmd[0] : "yarn",
    cmd ? cmd.slice(1) : ["dev"],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    },
  );

  const prefix = `${color}[${name}]${COLORS.RESET} `;
  const pipe = (stream, out) => {
    stream.on("data", (chunk) => {
      chunk
        .toString()
        .split("\n")
        .forEach((line) => {
          if (line.trim()) out.write(prefix + line + "\n");
        });
    });
  };
  if (child.stdout) pipe(child.stdout, process.stdout);
  if (child.stderr) pipe(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    console.log(`${prefix}terminó (${signal || code})`);
  });

  children.push(child);
}

async function main() {
  startDatabase();
  const dbUp = await waitForPort(5432, 90000);
  if (!dbUp) {
    const dbPrefix = `${COLORS.DB}[DB]${COLORS.RESET} `;
    console.warn(`${dbPrefix}⚠️  No se detectó PostgreSQL en :5432; el backend reintentará la conexión al arrancar.`);
  }

  SERVICES.forEach(start);
  console.log("🌱 4 servicios levantados. Pulsa Ctrl+C para detener los servicios (la BD sigue arriba).");
}

main();

// ── Detención (Ctrl+C) ─────────────────────────────────────

function killAll() {
  console.log("\n⏹  Deteniendo servicios...");
  for (const child of children) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ya terminó */
        }
      }
    }
  }
  console.log("💡 La BD local sigue corriendo. Para detenerla: cd db/docker && docker compose stop");
}

process.on("SIGINT", () => {
  killAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  killAll();
  process.exit(0);
});
