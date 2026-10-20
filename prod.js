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
 * para no entrar en bucle de reinicio y construye/levanta.
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
  const recordName = (d) =>
    d === cfg.baseDomain ? "@ (raíz)" : d.slice(0, -(zone.length + 1));

  const doms = [cfg.hosts.web, cfg.hosts.api, cfg.hosts.admin];
  for (const [key] of FRONTS) if (key !== "web" && key !== "admin" && cfg.hosts[key]) doms.push(cfg.hosts[key]);

  console.log(`\n${bar}`);
  console.log(`  DNS y red a configurar (ecommerce)`);
  console.log(bar);
  line(`Dominio base : ${cfg.baseDomain}`);
  line(`IP pública   : ${ip}`);
  line(`Modo         : ${edge ? "edge (el edge compartido publica 80/443 y hace TLS)" : "directo (este contenedor publica 80/443 y hace TLS)"}`);
  console.log(bar);

  line(`${C.cyan}1) En GoDaddy → zona ${zone} → registros tipo A (TTL 600):${C.reset}`);
  line(`   Valor para todos: ${ip}`);
  line(`   ─────────────────────────────────────────────`);
  for (const d of doms) line(`   Nombre: ${recordName(d).padEnd(28)} →  ${d}`);
  line(`   ─────────────────────────────────────────────`);
  line(`${C.dim}   (No crees picking.mercaldas ni ml.mercaldas: no se sirven aquí.${C.reset}`);
  line(`${C.dim}    ml.mercaldas es opcional y lo sirve el contenedor de Astaroth.)${C.reset}`);

  console.log(bar);
  line(`${C.cyan}2) Firewall:${C.reset}`);
  if (edge) {
    line(`   Abre SOLO 80 y 443 (los publica el edge en docker/edge/).`);
    line(`   El contenedor publica ${cfg.edgePorts.http}/${cfg.edgePorts.https} en loopback: no abras nada más.`);
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

  node prod.js                 sincroniza docker/.env, construye y levanta
  node prod.js --no-build      levanta sin reconstruir la imagen
  node prod.js --with-db       además levanta db/docker y la conecta a la red
  node prod.js --dns           imprime los registros DNS/red a configurar
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
