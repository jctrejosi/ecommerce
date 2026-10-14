#!/usr/bin/env node
/**
 * Genera el Caddyfile del contenedor único de Mercaldas a partir de variables
 * de entorno, de modo que los dominios/hosts NO queden horneados en la imagen.
 *
 * Modo multi-host (recomendado): define `HOST_API` y, por cada interfaz que
 *   quieras publicar, su `HOST_<APP>` (p. ej. HOST_WEB=client.tudominio.com).
 *   Cada interfaz se sirve en su propio subdominio y el API (backend + bot)
 *   en HOST_API. El backend/bot solo escuchan en 127.0.0.1 dentro del contenedor.
 *
 * Si no defines ningún HOST_*, se genera un único vhost `:80` que solo proxya
 *   al backend (útil como smoke-test del contenedor).
 *
 * Variables:
 *   HOST_API            dominio del API (backend + /bot)         [opcional]
 *   HOST_WEB            cliente web          → /srv/web
 *   HOST_ADMIN          admin                → /srv/admin
 *   HOST_PICKING_ADMIN  picking admin        → /srv/picking-admin
 *   HOST_DELIVERY_ADMIN delivery admin       → /srv/delivery-admin
 *   TLS                 "true" (def.) | "false"  (false ⇒ HTTP en :80)
 *   ACME_EMAIL          email para Let's Encrypt (avisos de expiración)
 *   PROTECT_ADMIN       "true" ⇒ Basic Auth en los paneles de administración
 *   ADMIN_USER          usuario del Basic Auth           (def. admin)
 *   ADMIN_PASSWORD      contraseña en claro (se hashea con caddy bcrypt)
 *   ADMIN_PASSWORD_HASH hash bcrypt ya calculado (tiene prioridad)
 *   BACKEND_PORT        puerto interno del backend  (def. 3100)
 *   BOT_PORT            puerto interno del bot      (def. 8001)
 *   CADDYFILE_OUT       ruta de salida (def. /app/Caddyfile.generated)
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const env = process.env;
const TLS = String(env.TLS ?? "true").toLowerCase() !== "false";
const EMAIL = (env.ACME_EMAIL || "").trim();
const BACKEND = `127.0.0.1:${env.BACKEND_PORT || 3100}`;
const BOT = `127.0.0.1:${env.BOT_PORT || 8001}`;

// Interfaz → variable de entorno del host y directorio dentro de la imagen.
// `admin: true` ⇒ es un panel de administración (candidato a Basic Auth).
const FRONTS = [
  { envKey: "HOST_WEB", dir: "/srv/web" },
  { envKey: "HOST_ADMIN", dir: "/srv/admin", admin: true },
  { envKey: "HOST_PICKING_ADMIN", dir: "/srv/picking-admin", admin: true },
  { envKey: "HOST_DELIVERY_ADMIN", dir: "/srv/delivery-admin", admin: true },
];

const hostOf = (k) => (env[k] || "").trim();
const HOST_API = hostOf("HOST_API");
const frontHosts = FRONTS.map((f) => ({ ...f, host: hostOf(f.envKey) })).filter((f) => f.host);
const anyHost = Boolean(HOST_API) || frontHosts.length > 0;

// ── Basic Auth opcional para los paneles de administración ──
const PROTECT_ADMIN = String(env.PROTECT_ADMIN || "false").toLowerCase() === "true";
let basicAuth = "";
if (PROTECT_ADMIN) {
  let hash = (env.ADMIN_PASSWORD_HASH || "").trim();
  if (!hash && env.ADMIN_PASSWORD) {
    const r = spawnSync("caddy", ["hash-password", "--plaintext", env.ADMIN_PASSWORD], {
      encoding: "utf8",
    });
    if (r.status === 0) hash = (r.stdout || "").trim();
  }
  if (hash) {
    basicAuth = `\tbasic_auth {\n\t\t${env.ADMIN_USER || "admin"} ${hash}\n\t}\n`;
  } else {
    console.warn(
      "⚠️  PROTECT_ADMIN=true pero falta ADMIN_PASSWORD/ADMIN_PASSWORD_HASH (o el binario caddy); los paneles NO se protegen.",
    );
  }
}

// ── Cabeceras de seguridad comunes a todos los vhosts ───────
const headerLines = [
  `\tX-Content-Type-Options "nosniff"`,
  `\tX-Frame-Options "SAMEORIGIN"`,
  `\tReferrer-Policy "strict-origin-when-cross-origin"`,
  `\t-Server`,
];
if (TLS) headerLines.unshift(`\tStrict-Transport-Security "max-age=31536000; includeSubDomains"`);
const headerBlock = `\theader {\n${headerLines.join("\n")}\n\t}\n`;

const apiBlock = `${headerBlock}\tencode zstd gzip
	handle_path /bot/* {
		reverse_proxy ${BOT}
	}
	handle {
		reverse_proxy ${BACKEND}
	}`;

const staticBlock = (dir, withAuth) => `${headerBlock}${withAuth ? basicAuth : ""}\tencode zstd gzip
	root * ${dir}
	try_files {path} /index.html
	file_server`;

let out = "";

// Con TLS desactivado hay que forzar el esquema `http://`: un hostname sin
// esquema hace que Caddy asuma HTTPS (y escucharía en :443, no en :80).
const siteAddr = (host) => (TLS ? host : `http://${host}`);

if (anyHost) {
  // Opciones globales (email ACME / HTTP puro).
  const opts = [];
  if (EMAIL) opts.push(`\temail ${EMAIL}`);
  if (!TLS) opts.push("\tauto_https off");
  if (opts.length) out += `{\n${opts.join("\n")}\n}\n`;

  if (HOST_API) out += `\n${siteAddr(HOST_API)} {\n${apiBlock}\n}\n`;
  for (const f of frontHosts) {
    const withAuth = PROTECT_ADMIN && Boolean(f.admin) && Boolean(basicAuth);
    out += `\n${siteAddr(f.host)} {\n${staticBlock(f.dir, withAuth)}\n}\n`;
  }
} else {
  // Sin dominios configurados: vhost mínimo en :80 (solo API) como smoke-test.
  out +=
    `# ⚠️  No definiste ningún HOST_* — vhost mínimo (solo API).\n` +
    `#     Define HOST_API y HOST_WEB/HOST_ADMIN/... para publicar las interfaces.\n` +
    `:80 {\n${apiBlock}\n}\n`;
}

const dest = env.CADDYFILE_OUT || "/app/Caddyfile.generated";
fs.writeFileSync(dest, out);
process.stdout.write(`Caddyfile generado en ${dest}:\n${out}`);
