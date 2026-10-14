#!/usr/bin/env node
/**
 * Genera el Caddyfile del contenedor único de Mercaldas a partir de variables
 * de entorno, de modo que los dominios/hosts NO queden horneados en la imagen.
 *
 * Modo multi-host (recomendado): define `HOST_API` y, por cada interfaz que
 *   quieras publicar, su `HOST_<APP>` (p. ej. HOST_WEB=client.tudominio.com).
 *   Cada interfaz se sirve en su propio subdominio y el API (backend + bot)
 *   en HOST_API.
 *
 * Si no defines ningún HOST_*, se genera un único vhost `:80` que solo proxya
 *   al backend (útil como smoke-test del contenedor).
 *
 * Variables:
 *   HOST_API            dominio del API (backend + /bot)         [opcional]
 *   HOST_WEB            cliente web          → /srv/web
 *   HOST_ADMIN          admin                → /srv/admin
 *   HOST_PICKING        picking              → /srv/picking
 *   HOST_PICKING_ADMIN  picking admin        → /srv/picking-admin
 *   HOST_DELIVERY_ADMIN delivery admin       → /srv/delivery-admin
 *   TLS                 "true" (def.) | "false"  (false ⇒ HTTP en :80)
 *   ACME_EMAIL          email para Let's Encrypt (avisos de expiración)
 *   BACKEND_PORT        puerto interno del backend  (def. 3100)
 *   BOT_PORT            puerto interno del bot      (def. 8001)
 *   CADDYFILE_OUT       ruta de salida (def. /app/Caddyfile.generated)
 */
import fs from "node:fs";

const env = process.env;
const TLS = String(env.TLS ?? "true").toLowerCase() !== "false";
const EMAIL = (env.ACME_EMAIL || "").trim();
const BACKEND = `127.0.0.1:${env.BACKEND_PORT || 3100}`;
const BOT = `127.0.0.1:${env.BOT_PORT || 8001}`;

// Interfaz → variable de entorno del host y directorio dentro de la imagen.
const FRONTS = [
  { envKey: "HOST_WEB", dir: "/srv/web" },
  { envKey: "HOST_ADMIN", dir: "/srv/admin" },
  { envKey: "HOST_PICKING", dir: "/srv/picking" },
  { envKey: "HOST_PICKING_ADMIN", dir: "/srv/picking-admin" },
  { envKey: "HOST_DELIVERY_ADMIN", dir: "/srv/delivery-admin" },
];

const hostOf = (k) => (env[k] || "").trim();
const HOST_API = hostOf("HOST_API");
const frontHosts = FRONTS.map((f) => ({ ...f, host: hostOf(f.envKey) })).filter((f) => f.host);
const anyHost = Boolean(HOST_API) || frontHosts.length > 0;

const apiBlock = `
	encode zstd gzip
	handle_path /bot/* {
		reverse_proxy ${BOT}
	}
	handle {
		reverse_proxy ${BACKEND}
	}`;

const staticBlock = (dir) => `
	encode zstd gzip
	root * ${dir}
	try_files {path} /index.html
	file_server`;

let out = "";

if (anyHost) {
  // Opciones globales (email ACME / HTTP puro).
  const opts = [];
  if (EMAIL) opts.push(`	email ${EMAIL}`);
  if (!TLS) opts.push("	auto_https off");
  if (opts.length) out += `{\n${opts.join("\n")}\n}\n`;

  if (HOST_API) out += `\n${HOST_API} {${apiBlock}\n}\n`;
  for (const f of frontHosts) out += `\n${f.host} {${staticBlock(f.dir)}\n}\n`;
} else {
  // Sin dominios configurados: vhost mínimo en :80 (solo API) como smoke-test.
  out +=
    `# ⚠️  No definiste ningún HOST_* — vhost mínimo (solo API).\n` +
    `#     Define HOST_API y HOST_WEB/HOST_ADMIN/... para publicar las interfaces.\n` +
    `:80 {${apiBlock}\n}\n`;
}

const dest = env.CADDYFILE_OUT || "/app/Caddyfile.generated";
fs.writeFileSync(dest, out);
process.stdout.write(`Caddyfile generado en ${dest}:\n${out}`);
