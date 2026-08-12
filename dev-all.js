#!/usr/bin/env node
/**
 * Levanta los 3 servicios de MercAldas en local.
 * Uso: node dev-all.js   (o: ./dev-all.js en bash)   —  Ctrl+C detiene todo.
 *
 * Antes de arrancar cada servicio libera su puerto (mata procesos previos),
 * evitando errores de EADDRINUSE / "address already in use".
 */
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = __dirname;

const SERVICES = [
  { name: "BACKEND", dir: "backend", url: "http://localhost:3000" },
  { name: "WEB", dir: "Interfaz web client", url: "http://localhost:5173" },
  { name: "ADMIN", dir: "Interfaz web admin", url: "http://localhost:8443" },
];

const COLORS = {
  BACKEND: "\x1b[31m",
  WEB: "\x1b[32m",
  ADMIN: "\x1b[34m",
  RESET: "\x1b[0m",
};

const children = [];

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
        const m = line.trim().match(/:${port}\s+.*?LISTENING\s+(\d+)\s*$/);
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

function start(name, dir, url) {
  const cwd = path.join(ROOT, dir);
  const color = COLORS[name] || "";
  const port = new URL(url).port;

  console.log(`${color}[${name}]${COLORS.RESET} ▶ ${url}  (cwd: ${cwd})`);

  // Liberar el puerto antes de levantar (evita EADDRINUSE)
  killPort(port);
  sleepSync(800); // dar tiempo a que el SO libere el socket

  const child = spawn("yarn", ["dev"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });

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

SERVICES.forEach((s) => start(s.name, s.dir, s.url));
console.log("🌱 3 servicios levantados. Pulsa Ctrl+C para detener todos.");

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
}

process.on("SIGINT", () => {
  killAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  killAll();
  process.exit(0);
});
