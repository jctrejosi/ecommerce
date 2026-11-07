#!/usr/bin/env node
/**
 * prod.js — despliegue de PRODUCCIÓN de Mercaldas en CONTENEDOR (docker/).
 *
 * Independiente del entorno local: no compila nada con npm/pnpm/python en esta
 * máquina — todo se construye dentro de la imagen. Solo necesita `docker`
 * (+ `node` para correr este launcher).
 *
 * `node prod.js` sincroniza `docker/.env` desde `prod.config.json` (dominios,
 * TLS y puertos — sin pisar secretos), valida lo que el contenedor necesita
 * para no entrar en bucle de reinicio, comprueba que los puertos del host estén
 * libres (o sean del propio contenedor) y construye/levanta.
 *
 * ¿Modo bare-metal (compilar y servir desde esta máquina)? Ese es `prod-local.js`.
 *
 * Uso:
 *   node prod.js --init-config   → crea prod.config.json (plantilla)
 *   node prod.js --dns           → imprime los registros DNS/red a configurar
 *   node prod.js                 → sincroniza, construye y levanta
 *   node prod.js --no-build      → levanta sin reconstruir la imagen
 *   node prod.js --with-db       → además levanta db/docker y la conecta a la red
 *   node prod.js --stop          → detiene el contenedor (down)
 *   node prod.js --logs          → logs en vivo
 *   node prod.js --status        → estado del contenedor
 *   node prod.js --config <ruta> → usa otro prod.config.json
 *   node prod.js --help
 */
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DOCKER_DIR = path.join(ROOT, "docker");
const COMPOSE_APP = path.join(DOCKER_DIR, "docker-compose.yml");
const COMPOSE_DB = path.join(ROOT, "db", "docker", "docker-compose.yml");
const ENV_FILE = path.join(DOCKER_DIR, ".env");
const ENV_EXAMPLE = path.join(DOCKER_DIR, ".env.example");

const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const CONFIG_IDX = ARGS.indexOf("--config");
const CONFIG_PATH =
  CONFIG_IDX >= 0 && ARGS[CONFIG_IDX + 1]
    ? path.resolve(ROOT, ARGS[CONFIG_IDX + 1])
    : path.join(ROOT, "prod.config.json");

const C = {
  ok: "\x1b[32m",
  err: "\x1b[31m",
  warn: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};
const rel = (p) => path.relative(ROOT, p) || ".";
const die = (msg) => {
  console.error(`\n${C.err}✘ ${msg}${C.reset}\n`);
  process.exit(1);
};

// ── Configuración ───────────────────────────────────────────
/** Interfaz web → clave en hosts y variable del .env del contenedor. */
const FRONTS = [
  ["web", "HOST_WEB"],
  ["admin", "HOST_ADMIN"],
  ["picking-admin", "HOST_PICKING_ADMIN"],
  ["delivery-admin", "HOST_DELIVERY_ADMIN"],
];

const CONFIG_TEMPLATE = {
  mode: "edge",
  dnsZone: "tudominio.com",
  baseDomain: "tudominio.com",
  publicIp: "<IP_PUBLICA_DEL_SERVIDOR>",
  acmeEmail: "admin@tudominio.com",
  tls: true,
  // Client ID público de Google OAuth (opcional). Se hornea en el front.
  googleClientId: "",
  googleRedirectUri: "",
  edgePorts: { http: "127.0.0.1:30180", https: "127.0.0.1:30181" },
  hosts: {
    web: "tudominio.com",
    admin: "admin.tudominio.com",
    "picking-admin": "picking-admin.tudominio.com",
    "delivery-admin": "delivery-admin.tudominio.com",
    api: "api.tudominio.com",
  },
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    die(
      `No existe ${rel(CONFIG_PATH)}. Créalo con:  node prod.js --init-config\n` +
        `  (el del repositorio ya viene configurado para este servidor).`,
    );
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    die(`${rel(CONFIG_PATH)} no es JSON válido: ${e.message}`);
  }
  cfg.mode = cfg.mode === "direct" ? "direct" : "edge";
  cfg.hosts = cfg.hosts ?? {};
  cfg.edgePorts = cfg.edgePorts ?? CONFIG_TEMPLATE.edgePorts;
  if (!cfg.hosts.web) die(`Falta "hosts.web" en ${rel(CONFIG_PATH)}.`);
  if (!cfg.hosts.api) die(`Falta "hosts.api" en ${rel(CONFIG_PATH)}.`);
  if (!cfg.acmeEmail) die(`Falta "acmeEmail" en ${rel(CONFIG_PATH)}.`);
  return cfg;
}

const schemeOf = (cfg) => (cfg.tls ? "https" : "http");
const edgeMode = (cfg) => cfg.mode !== "direct";

// ── docker/.env ─────────────────────────────────────────────
/** Actualiza/agrega pares KEY=valor conservando el resto del archivo. */
function setEnvKeys(text, pairs) {
  let out = text;
  const added = [];
  for (const [key, value] of Object.entries(pairs)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(out)) {
      out = out.replace(re, `${key}=${value}`);
    } else if (new RegExp(`^#\\s*${key}=`, "m").test(out)) {
      // clave comentada: se descomenta con el valor nuevo.
      out = out.replace(new RegExp(`^#\\s*${key}=.*$`, "m"), `${key}=${value}`);
    } else {
      added.push(`${key}=${value}`);
    }
  }
  if (added.length) {
    if (!out.endsWith("\n")) out += "\n";
    out += `\n# ── Sincronizado por prod.js desde prod.config.json ──\n${added.join("\n")}\n`;
  }
  return out;
}

function envValue(text, key) {
  const m = text.match(new RegExp(`^\\s*${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

function syncEnvFile(cfg) {
  if (!fs.existsSync(ENV_FILE)) {
    if (!fs.existsSync(ENV_EXAMPLE)) die(`Falta ${rel(ENV_EXAMPLE)} (no puedo crear docker/.env).`);
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log(`✅ Creado ${rel(ENV_FILE)} a partir del ejemplo.`);
  }
  const text = fs.readFileSync(ENV_FILE, "utf8");

  const edge = edgeMode(cfg);
  const scheme = schemeOf(cfg);
  const containerTls = !edge && cfg.tls !== false;
  const pairs = {
    HOST_API: cfg.hosts.api,
    HOST_WEB: cfg.hosts.web,
    // Modo edge: el TLS lo termina el edge compartido; el contenedor sirve
    // HTTP en loopback (por eso ALLOW_INSECURE=true, aceptado explícitamente)
    // y el esquema público real se declara en PUBLIC_SCHEME.
    TLS: containerTls ? "true" : "false",
    ALLOW_INSECURE: containerTls ? "false" : "true",
    PUBLIC_SCHEME: scheme,
    ACME_EMAIL: cfg.acmeEmail,
    VITE_API_URL: `${scheme}://${cfg.hosts.api}`,
    PUBLIC_HTTP_PORT: edge ? cfg.edgePorts.http : String(cfg.publicHttpPort),
    PUBLIC_HTTPS_PORT: edge ? cfg.edgePorts.https : String(cfg.publicHttpsPort),
  };
  for (const [key, envKey] of FRONTS) {
    if (cfg.hosts[key]) pairs[envKey] = cfg.hosts[key];
  }
  if (cfg.googleClientId) pairs.VITE_GOOGLE_CLIENT_ID = cfg.googleClientId;
  if (cfg.googleRedirectUri) pairs.VITE_GOOGLE_REDIRECT_URI = cfg.googleRedirectUri;

  fs.writeFileSync(ENV_FILE, setEnvKeys(text, pairs));
  try {
    fs.chmodSync(ENV_FILE, 0o600);
  } catch {
    /* Windows */
  }
  console.log(`✅ ${rel(ENV_FILE)} sincronizado (dominios, TLS, URLs y puertos).`);

  // Fail-closed del contenedor: avisamos aquí, no en los logs de Docker.
  const current = fs.readFileSync(ENV_FILE, "utf8");
  const problems = [];
  const mediaStorage = envValue(current, "MEDIA_STORAGE").toLowerCase();
  const cloud = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].filter(
    (k) => !envValue(current, k),
  );
  if (mediaStorage === "local") {
    console.log(
      `ℹ️  MEDIA_STORAGE=local → las imágenes se guardan en el volumen ${C.dim}media${C.reset} (sin Cloudinary).`,
    );
  } else if (cloud.length) {
    problems.push(
      `Faltan ${cloud.join(", ")} → el backend aborta ("Cloudinary credentials are required"). ` +
        `Usa MEDIA_STORAGE=local si no quieres depender de Cloudinary.`,
    );
  }
  if (!envValue(current, "ADMIN_PASSWORD") && !envValue(current, "ADMIN_PASSWORD_HASH")) {
    problems.push("Falta ADMIN_PASSWORD/HASH → los paneles son fail-closed (Basic Auth).");
  }
  if (!envValue(current, "DATABASE_URL")) {
    problems.push("Falta DATABASE_URL → la BD no vive en este contenedor (db/docker o gestionada).");
  }
  if (problems.length) {
    console.error(`\n${C.err}✘ docker/.env está incompleto (el contenedor NO arrancaría):${C.reset}`);
    for (const p of problems) console.error(`   • ${p}`);
    console.error(`   Genera los secretos con:  node scripts-agent/set-prod-secrets.mjs`);
    console.error(`   y edita ${rel(ENV_FILE)} antes de reintentar.`);
    process.exit(1);
  }

  if (!envValue(current, "JWT_SECRET")) {
    console.warn(
      `\n${C.warn}⚠️  JWT_SECRET vacío — genéralo con: node scripts-agent/set-prod-secrets.mjs${C.reset}`,
    );
  }
  if (!envValue(current, "DEEPSEEK_API_KEY")) {
    console.warn(`${C.warn}⚠️  DEEPSEEK_API_KEY vacía — el bot de compras no responderá.${C.reset}`);
  }
}

// ── DNS / red ───────────────────────────────────────────────
function printDns(cfg) {
  const edge = edgeMode(cfg);
  const ip = cfg.publicIp || "<IP_PUBLICA_DEL_SERVIDOR>";
  const zone = cfg.dnsZone || (cfg.baseDomain || "").split(".").slice(1).join(".");
  const W = 66;
  const bar = "━".repeat(W);
  const line = (s = "") => console.log(`  ${s}`);
  const recordName = (d) => d.slice(0, -(zone.length + 1));

  const doms = [cfg.hosts.web, cfg.hosts.api, cfg.hosts.admin];
  for (const [key] of FRONTS) if (key !== "web" && key !== "admin" && cfg.hosts[key]) doms.push(cfg.hosts[key]);

  console.log(`\n${bar}`);
  console.log(`  DNS y red a configurar (ecommerce)`);
  console.log(bar);
  line(`Dominio base : ${cfg.baseDomain}`);
  line(`IP pública   : ${ip}`);
  line(`Modo         : ${edge ? "edge (el edge compartido publica 80/443 y hace TLS)" : "directo (este contenedor publica 80/443 y hace TLS)"}`);
  console.log(bar);

  line(`${C.cyan}1) En Cloudflare → zona ${zone} → registros tipo A (proxied/naranja):${C.reset}`);
  line(`   Valor para todos: ${ip}`);
  line(`   ─────────────────────────────────────────────`);
  for (const d of doms) line(`   Nombre: ${recordName(d).padEnd(28)} →  ${d}`);
  line(`   ─────────────────────────────────────────────`);
  line(`${C.warn}   Un solo nivel bajo ${zone}: el Universal SSL gratuito de Cloudflare${C.reset}`);
  line(`${C.warn}   cubre ${zone} y *.${zone}. Un \`api.mercaldas.${zone}\` NO recibe${C.reset}`);
  line(`${C.warn}   certificado en el borde (handshake TLS falla).${C.reset}`);
  line(`${C.dim}   (No crees picking.mercaldas ni ml.mercaldas: no se sirven aquí.${C.reset}`);
  line(`${C.dim}    ml.mercaldas es opcional y lo sirve el contenedor de Astaroth.)${C.reset}`);

  console.log(bar);
  line(`${C.cyan}2) Firewall:${C.reset}`);
  if (edge) {
    line(`   Abre SOLO 80 y 443 (los publica el edge en docker/edge/).`);
    line(`   El contenedor publica ${cfg.edgePorts.http}/${cfg.edgePorts.https} en loopback: no abras nada más.`);
    line(`   Con Cloudflare delante, 80/443 se restringen a sus rangos`);
    line(`   (docker/edge/cloudflare-origin-firewall.sh + unit systemd).`);
  } else {
    line(`   Abre SOLO TCP 80 y 443 en el proveedor del VPS y en Windows.`);
  }

  console.log(bar);
  line(`${C.cyan}3) Base de datos (no vive en este contenedor):${C.reset}`);
  line(`   node prod.js --with-db`);
  line(`${C.dim}   (levanta db/docker y conecta ecommerce_postgres a mercaldas_internal)${C.reset}`);

  console.log(bar);
  line(`${C.cyan}4) OSRM — rutas de delivery:${C.reset}`);
  line(`   Incluido en docker/docker-compose.yml (servicio osrm, solo red interna).`);
  line(`   Requiere los datos en delivery-routing/data/manizales.osrm*`);
  line(`${C.dim}   (si faltan: ./delivery-routing/prepare.sh)${C.reset}`);

  if (edge) {
    console.log(bar);
    line(`${C.cyan}5) Edge (el único que publica 80/443):${C.reset}`);
    line(`   cd docker/edge && docker compose up -d`);
    line(`${C.dim}   (el Caddyfile del edge ya incluye todos estos dominios)${C.reset}`);
  }

  console.log(bar);
  line(`${C.cyan}6) Apps móviles (Expo) — no se sirven aquí:${C.reset}`);
  line(`   Compila los APK/IPA con  EXPO_PUBLIC_API_URL=${schemeOf(cfg)}://${cfg.hosts.api}`);

  console.log(bar);
  line(`${C.cyan}Mapa dominio → servicio (Caddy del contenedor):${C.reset}`);
  line(`   ${cfg.hosts.api.padEnd(34)} → backend (y /bot)`);
  line(`   ${cfg.hosts.web.padEnd(34)} → tienda web`);
  if (cfg.hosts.admin) line(`   ${cfg.hosts.admin.padEnd(34)} → panel admin`);
  if (cfg.hosts["picking-admin"]) line(`   ${cfg.hosts["picking-admin"].padEnd(34)} → picking admin`);
  if (cfg.hosts["delivery-admin"]) line(`   ${cfg.hosts["delivery-admin"].padEnd(34)} → delivery admin`);
  console.log(`${bar}\n`);
}

// ── docker ──────────────────────────────────────────────────
function compose(file, args) {
  return cp.spawnSync("docker", ["compose", "-f", file, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
}

function checkDocker() {
  const r = cp.spawnSync("docker", ["--version"], { stdio: "ignore", windowsHide: true });
  if (r.status !== 0) die(`Docker no está disponible en el PATH (¿Docker Desktop / WSL2 arrancado?).`);
}

// ── Puertos del host ────────────────────────────────────────
const APP_CONTAINER = "mercaldas_app";
const EDGE_CONTAINER = "edge_caddy";

/** "127.0.0.1:30180" | "80" | "[::1]:30180" → { raw, port }. */
function parseHostPort(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) return null;
  const noProto = raw.replace(/\/tcp$/i, "");
  let portText = noProto;
  if (noProto.startsWith("[")) {
    const idx = noProto.lastIndexOf("]:");
    portText = idx >= 0 ? noProto.slice(idx + 2) : noProto;
  } else if (noProto.includes(":")) {
    portText = noProto.slice(noProto.lastIndexOf(":") + 1);
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { raw, port };
}

function run(cmd, args) {
  return cp.spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
}

/** Contenedores activos y sus puertos publicados en el host. */
function dockerSnapshot() {
  const r = run("docker", [
    "ps",
    "--format",
    "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}",
  ]);
  if (r.status !== 0) return [];
  return (r.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, image, status, ports] = line.split("\t");
      const hostPorts = new Set();
      const re = /:(\d+)->/g;
      let match;
      while ((match = re.exec(ports || ""))) hostPorts.add(Number(match[1]));
      return { name, image, status, ports: ports || "", hostPorts };
    });
}

function processCommand(pid) {
  if (!pid) return "";
  const r = run("ps", ["-p", String(pid), "-o", "args="]);
  if (r.status !== 0) return "";
  return (r.stdout || "").trim().split(/\r?\n/)[0].slice(0, 180);
}

function linuxListeners(port) {
  const ss = run("ss", ["-ltnpH", `sport = :${port}`]);
  if (ss.status === 0) {
    const out = ss.stdout || "";
    if (!out.trim()) return [];
    const found = [];
    const re = /users:\(\("([^"]+)",pid=(\d+)/g;
    let match;
    while ((match = re.exec(out))) {
      found.push({
        name: match[1],
        pid: Number(match[2]),
        command: processCommand(Number(match[2])),
      });
    }
    return found.length
      ? found
      : [
          {
            name: "proceso no identificado",
            pid: null,
            command: "requiere permisos para ver el PID",
          },
        ];
  }

  const lsof = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "pcn"]);
  if (lsof.status === 0) {
    const out = lsof.stdout || "";
    if (!out.trim()) return [];
    const found = [];
    let current = null;
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("p")) {
        if (current && current.pid) found.push(current);
        current = { pid: Number(line.slice(1)) };
      } else if (line.startsWith("c") && current) {
        current.name = line.slice(1);
      }
    }
    if (current && current.pid) found.push(current);
    if (found.length) {
      for (const item of found) item.command = processCommand(item.pid);
      return found;
    }
  }

  const netstat = run("netstat", ["-ltnp"]);
  if (netstat.status === 0) {
    const line = (netstat.stdout || "")
      .split(/\r?\n/)
      .find((l) => new RegExp(`:${port}\\s`).test(l));
    if (line) {
      const m = line.match(/\s(\d+)\/([^\s]+)$/);
      return [
        {
          name: m ? m[2] : "proceso no identificado",
          pid: m ? Number(m[1]) : null,
          command: m ? processCommand(Number(m[1])) : "",
        },
      ];
    }
  }
  return [];
}

function windowsListeners(port) {
  const netstat = run("netstat", ["-ano", "-p", "tcp"]);
  if (netstat.status !== 0) return [];
  const pids = new Set();
  for (const line of (netstat.stdout || "").split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[3] !== "LISTENING") continue;
    if (!new RegExp(`:${port}$`).test(cols[1])) continue;
    pids.add(Number(cols[4]));
  }
  const found = [];
  for (const pid of pids) {
    const q = run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    const name = (q.stdout || "").match(/^"([^"]+)"/)?.[1] || "proceso no identificado";
    found.push({ name, pid, command: "" });
  }
  return found;
}

function hostListeners(port) {
  return process.platform === "win32" ? windowsListeners(port) : linuxListeners(port);
}

function describeContainers(containers) {
  return containers.map((c) => `${c.name} (${c.image})`).join(", ");
}

function describeListener(listener) {
  const bits = [];
  if (listener.name) bits.push(listener.name);
  if (listener.pid) bits.push(`PID ${listener.pid}`);
  const head = bits.join(" · ") || "proceso no identificado";
  return listener.command ? `${head}\n        ${listener.command}` : head;
}

/**
 * Comprueba los puertos publicados antes de construir/levantar.
 * - Si el puerto lo tiene `mercaldas_app`, es el propio stack: se recreará.
 * - Si lo tiene otro contenedor o proceso, aborta y muestra quién lo usa.
 * - En modo edge, 80/443 son del edge compartido: si están ocupados por otro,
 *   avisa (el edge no podrá publicar) pero no impide desplegar la app.
 */
function checkHostPorts(cfg) {
  const text = fs.readFileSync(ENV_FILE, "utf8");
  const edge = edgeMode(cfg);
  const defaultHttp = edge ? "127.0.0.1:30180" : "80";
  const defaultHttps = edge ? "127.0.0.1:30181" : "443";
  const http = parseHostPort(envValue(text, "PUBLIC_HTTP_PORT"), defaultHttp);
  const https = parseHostPort(envValue(text, "PUBLIC_HTTPS_PORT"), defaultHttps);
  const appPorts = [
    http && { ...http, internal: 8080, label: "HTTP de la app" },
    https && { ...https, internal: 8443, label: "HTTPS de la app" },
  ].filter(Boolean);
  const containers = dockerSnapshot();
  const conflicts = [];

  console.log(`\n${C.cyan}==> Comprobando puertos del host…${C.reset}`);
  for (const item of appPorts) {
    const owners = containers.filter((c) => c.hostPorts.has(item.port));
    const own = owners.find((c) => c.name === APP_CONTAINER);
    if (own) {
      console.log(`  ✅ ${item.raw} (${item.label}) → ${APP_CONTAINER} ya lo usa; se recreará.`);
      continue;
    }
    if (owners.length) {
      conflicts.push({ port: item.port, raw: item.raw, owners: describeContainers(owners) });
      continue;
    }
    const listeners = hostListeners(item.port);
    if (listeners.length) {
      conflicts.push({ port: item.port, raw: item.raw, listeners });
    } else {
      console.log(`  ✅ ${item.raw} (${item.label}) → libre.`);
    }
  }

  if (conflicts.length) {
    console.error(`\n${C.err}✘ Hay puertos ocupados por otros servicios:${C.reset}`);
    for (const conflict of conflicts) {
      console.error(`   • ${conflict.raw} (puerto ${conflict.port})`);
      if (conflict.owners) {
        console.error(`     Contenedor(es): ${conflict.owners}`);
      } else {
        for (const listener of conflict.listeners) {
          console.error(`     ${describeListener(listener)}`);
        }
      }
    }
    console.error(
      `\n   Detén esos servicios o cambia PUBLIC_HTTP_PORT / PUBLIC_HTTPS_PORT en ${rel(ENV_FILE)}.`,
    );
    console.error(`   No se construyó ni levantó nada.\n`);
    process.exit(1);
  }

  if (!edge) return;

  for (const port of [80, 443]) {
    if (appPorts.some((item) => item.port === port)) continue;
    const owners = containers.filter((c) => c.hostPorts.has(port));
    const edgeOwner = owners.find((c) => c.name === EDGE_CONTAINER);
    if (edgeOwner) {
      console.log(`  ✅ ${port} → ${EDGE_CONTAINER} (edge compartido).`);
      continue;
    }
    if (owners.length) {
      console.warn(
        `  ${C.warn}⚠️  ${port} está ocupado por ${describeContainers(owners)}; el edge no podrá publicar ese puerto.${C.reset}`,
      );
      continue;
    }
    const listeners = hostListeners(port);
    if (listeners.length) {
      console.warn(
        `  ${C.warn}⚠️  ${port} está ocupado por otro proceso; el edge no podrá publicar ese puerto.${C.reset}`,
      );
      for (const listener of listeners) console.warn(`     ${describeListener(listener)}`);
    } else {
      console.warn(
        `  ${C.warn}⚠️  ${port} está libre: el edge compartido no está publicado (docker/edge/).${C.reset}`,
      );
    }
  }
}

/** Levanta la BD de db/docker y la conecta a la red interna del contenedor. */
function withDb() {
  const up = compose(COMPOSE_DB, ["up", "-d"]);
  if (up.status !== 0) die(`Falló docker compose up de ${rel(COMPOSE_DB)}.`);
  const r = cp.spawnSync("docker", ["network", "connect", "mercaldas_internal", "ecommerce_postgres"], {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status === 0) {
    console.log(`✅ ecommerce_postgres conectado a mercaldas_internal.`);
  } else if (/already exists|is already connected/i.test(r.stderr || "")) {
    console.log(`ℹ️  ecommerce_postgres ya estaba en mercaldas_internal.`);
  } else {
    console.warn(`${C.warn}⚠️  No pude conectar ecommerce_postgres a mercaldas_internal:${C.reset}`);
    console.warn(`   ${(r.stderr || "").trim().split("\n").pop()}`);
  }
}

function printHelp() {
  console.log(`
Mercaldas — despliegue de producción en CONTENEDOR (docker/)

  node prod.js                 sincroniza docker/.env, comprueba puertos, construye y levanta
  node prod.js --no-build      levanta sin reconstruir la imagen
  node prod.js --with-db       además levanta db/docker y la conecta a la red
  node prod.js --dns           imprime los registros DNS/red a configurar
  node prod.js --check-ports   solo comprueba los puertos del host y sale
  node prod.js --status        estado del contenedor
  node prod.js --logs          logs en vivo
  node prod.js --stop          detiene el contenedor
  node prod.js --init-config   crea prod.config.json (plantilla)
  node prod.js --config <ruta> usa otro prod.config.json
  node prod.js --help

Dominios/TLS/puertos : prod.config.json (mode: edge|direct)
Secretos (JWT, panel, Cloudinary, BD): docker/.env
  → node scripts-agent/set-prod-secrets.mjs (genera JWT_SECRET y ADMIN_PASSWORD)

Bare-metal (compilar aquí): prod-local.js
`);
}

function main() {
  if (has("--help")) return printHelp();

  if (has("--init-config")) {
    if (fs.existsSync(CONFIG_PATH)) die(`Ya existe ${rel(CONFIG_PATH)}.`);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n");
    console.log(`✅ Creado ${rel(CONFIG_PATH)} — edita dominios/IP y ejecuta:  node prod.js --dns`);
    return;
  }

  const cfg = loadConfig();

  if (has("--dns")) return printDns(cfg);

  checkDocker();

  if (has("--check-ports")) {
    syncEnvFile(cfg);
    checkHostPorts(cfg);
    return;
  }

  if (has("--stop")) {
    compose(COMPOSE_APP, ["down"]);
    return;
  }
  if (has("--logs")) {
    compose(COMPOSE_APP, ["logs", "-f", "app"]);
    return;
  }
  if (has("--status")) {
    compose(COMPOSE_APP, ["ps"]);
    return;
  }

  // Despliegue completo.
  syncEnvFile(cfg);
  checkHostPorts(cfg);

  if (!has("--no-build")) {
    console.log(`\n==> construyendo imagen (bake de VITE_API_URL=${schemeOf(cfg)}://${cfg.hosts.api})…`);
    const b = compose(COMPOSE_APP, ["build"]);
    if (b.status !== 0) die(`Falló la construcción de la imagen.`);
  }

  console.log(`\n==> levantando contenedor…`);
  const u = compose(COMPOSE_APP, ["up", "-d"]);
  if (u.status !== 0) die(`Falló docker compose up.`);

  if (has("--with-db")) withDb();

  compose(COMPOSE_APP, ["ps"]);
  const donde = edgeMode(cfg)
    ? `${cfg.edgePorts.http}/${cfg.edgePorts.https} en loopback (lo alcanza el edge por shared_edge)`
    : `${cfg.publicHttpPort}/${cfg.publicHttpsPort} público (TLS propio para ${cfg.hosts.api})`;
  console.log(`
${C.ok}✅ Mercaldas (ecommerce) desplegado.${C.reset}

  • Publicado en : ${donde}
  • Logs         : node prod.js --logs
  • DNS/red      : node prod.js --dns
  • BD           : node prod.js --with-db   (si aún no la levantaste)

${C.warn}Si es la primera vez:  node prod.js --dns  y levanta el edge (docker/edge/).${C.reset}
`);
}

main();
