#!/usr/bin/env node
/**
 * Genera el Caddyfile del contenedor `ecommerce_proxy` a partir de variables de
 * entorno, de modo que los dominios/hosts y los upstreams NO queden horneados
 * en la imagen. El TLS lo termina el edge compartido (Cloudflare Origin CA):
 * este proxy solo habla HTTP en :8080 dentro de la red Docker.
 *
 * Modo multi-host (recomendado): define `HOST_API` y, por cada interfaz que
 *   quieras publicar, su `HOST_<APP>` (p. ej. HOST_WEB=ecommerce.tudominio.com).
 *   Cada interfaz se sirve desde su propio contenedor (`client`, `admin`,
 *   `picking`, `delivery`) y el API (backend) en HOST_API. El bot no se publica:
 *   el backend proxya /bot internamente.
 *
 * Si no defines ningún HOST_*, se genera un único vhost en el puerto HTTP que
 *   solo proxya al backend (útil como smoke-test).
 *
 * Variables:
 *   HOST_API              API completa. La raíz se reescribe a /webhooks/wompi
 *                         para pasarelas configuradas con el host pelado.
 *   HOST_WEB              cliente web; además proxya el API en el mismo origen
 *                         (rutas /catalog/*, /orders, /static/*, /bot/*, …)
 *   HOST_ADMIN            admin                → contenedor `admin`
 *   HOST_PICKING_ADMIN    picking admin        → contenedor `picking`
 *   HOST_DELIVERY_ADMIN   delivery admin       → contenedor `delivery`
 *   HOST_*_LEGACY         hosts heredados separados por comas que sirven lo
 *                         mismo (p. ej. HOST_WEB_LEGACY=mercaldas.jcti.xyz).
 *                         Permiten migrar el dominio sin romper APKs ya
 *                         instaladas, Google OAuth ni webhooks configurados.
 *   BACKEND_UPSTREAM      backend              (def. backend:3100)
 *   CLIENT_UPSTREAM       SPA cliente          (def. client:8080)
 *   ADMIN_UPSTREAM        SPA admin            (def. admin:8080)
 *   PICKING_UPSTREAM      SPA picking admin    (def. picking:8080)
 *   DELIVERY_UPSTREAM     SPA delivery admin   (def. delivery:8080)
 *   HTTP_PORT             puerto interno de Caddy (def. 8080)
 *   PROTECT_ADMIN         "true" (def.) ⇒ Basic Auth en los paneles de administración
 *   ADMIN_USER            usuario del Basic Auth           (def. admin)
 *   ADMIN_PASSWORD        contraseña en claro (se hashea con caddy bcrypt)
 *   ADMIN_PASSWORD_HASH   hash bcrypt ya calculado (tiene prioridad)
 *   MAX_REQUEST_BODY      tamaño máximo de cuerpo (def. 50MB; "0" ⇒ sin límite)
 *   CSP_POLICY            política CSP ("off"/"" ⇒ sin cabecera; por defecto una segura)
 *   CADDYFILE_OUT         ruta de salida (def. /config/Caddyfile.generated)
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const env = process.env;

const HTTP_PORT = String(env.HTTP_PORT || "8080").trim();

const BACKEND = (env.BACKEND_UPSTREAM || "backend:3100").trim();

// Límite de tamaño de cuerpo en el borde: evita que un cliente envíe cargas
// enormes (el backend acepta hasta 50 MB de JSON). "0"/vacío ⇒ sin límite.
const MAX_BODY = String(env.MAX_REQUEST_BODY ?? "50MB").trim();
const bodyLimit =
  MAX_BODY && MAX_BODY !== "0"
    ? `\trequest_body {\n\t\tmax_size ${MAX_BODY}\n\t}\n`
    : "";

// CSP por defecto: permite lo que ya usan las SPAs (MapLibre, Cloudinary,
// Google OAuth y el <script> inline de next-themes) pero cierra <object>,
// <base> inyectado y el framing. Endurécela con CSP_POLICY según cada app.
const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  // MapLibre GL crea su worker desde un blob: (los paneles de delivery/picking
  // pintan mapas). Sin worker-src explícito cae en script-src y se bloquea.
  "worker-src 'self' blob:",
  "frame-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  // Los pagos (Wompi/Epayco) hacen POST a otro origen: `form-action 'self'`
  // los rompería, por eso se permite https:.
  "form-action 'self' https:",
].join("; ");
const cspEnv = env.CSP_POLICY;
const CSP =
  cspEnv === undefined
    ? DEFAULT_CSP
    : /^(off|none|false|0|)$/i.test(cspEnv.trim())
      ? ""
      : cspEnv.trim();

// Interfaz → variable de host, upstream y si es panel de administración.
const FRONTS = [
  { envKey: "HOST_WEB", upstream: (env.CLIENT_UPSTREAM || "client:8080").trim(), web: true },
  { envKey: "HOST_ADMIN", upstream: (env.ADMIN_UPSTREAM || "admin:8080").trim(), admin: true },
  { envKey: "HOST_PICKING_ADMIN", upstream: (env.PICKING_UPSTREAM || "picking:8080").trim(), admin: true },
  { envKey: "HOST_DELIVERY_ADMIN", upstream: (env.DELIVERY_UPSTREAM || "delivery:8080").trim(), admin: true },
];

const hostOf = (k) => (env[k] || "").trim();
const hostList = (k) =>
  (env[k] || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
const HOST_API = hostOf("HOST_API");
const HOST_WEB = hostOf("HOST_WEB");
const apiHosts = [...new Set([HOST_API, ...hostList("HOST_API_LEGACY")].filter(Boolean))];
const frontHosts = FRONTS.map((f) => ({
  ...f,
  hosts: [...new Set([hostOf(f.envKey), ...hostList(`${f.envKey}_LEGACY`)].filter(Boolean))],
})).filter((f) => f.hosts.length > 0);
const anyHost = apiHosts.length > 0 || frontHosts.length > 0;

// ── Basic Auth de los paneles admin ──
const PROTECT_ADMIN = String(env.PROTECT_ADMIN ?? "true").toLowerCase() !== "false";
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
      "⚠️  PROTECT_ADMIN activo pero falta ADMIN_PASSWORD/ADMIN_PASSWORD_HASH " +
        "(o el binario caddy); NO se protegen los paneles.",
    );
  }
}

// ── Cabeceras de seguridad comunes a todos los vhosts ───────
// HSTS lo añade el edge (es quien termina TLS), no se duplica aquí.
const headerLines = [
  `\tX-Content-Type-Options "nosniff"`,
  `\tX-Frame-Options "SAMEORIGIN"`,
  `\tReferrer-Policy "strict-origin-when-cross-origin"`,
  `\tCross-Origin-Opener-Policy "same-origin-allow-popups"`,
  `\tPermissions-Policy "camera=(self), microphone=(self), geolocation=(self), payment=(self)"`,
  `\t-Server`,
];
if (CSP) headerLines.push(`\tContent-Security-Policy "${CSP}"`);
const headerBlock = `\theader {\n${headerLines.join("\n")}\n\t}\n`;

// El edge termina TLS y reenvía HTTP: el backend debe ver el esquema público.
const protoUp = " {\n\t\theader_up X-Forwarded-Proto https\n\t}";

const apiBlock = `${headerBlock}${bodyLimit}\tencode zstd gzip
	handle {
		reverse_proxy ${BACKEND}${protoUp}
	}`;

// ── Rutas del API servidas desde el mismo origen que la web ──
// Espejo de scripts-agent/serve-webclient.mjs más las rutas que usan los
// paneles y las apps móviles. La web del cliente solo tiene las páginas `/`,
// `/catalog` y `/account*`, así que estos prefijos no colisionan.
const API_PATHS = [
  "/api-status",
  "/discovery",
  "/banners",
  "/cart",
  "/orders",
  "/notifications",
  "/featured",
  "/filters",
  "/payments/methods",
  "/socket.io",
  "/bot",
  "/admin/*",
  "/auth/*",
  "/banners/*",
  "/bot/*",
  "/cart/*",
  "/catalog/*",
  "/customer-auth/*",
  "/delivery/*",
  "/featured/*",
  "/filters/*",
  "/geocode/*",
  "/landing/*",
  "/newsletter/*",
  "/notifications/*",
  "/orders/*",
  "/payments/*",
  "/picking/*",
  "/picking-admin/*",
  "/popups/*",
  "/qr/*",
  "/socket.io/*",
  "/static/*",
  "/upload/*",
  "/webhooks/*",
];

// Con HOST_WEB el API se sirve en el MISMO origen que la web del cliente
// (como en local con serve-webclient.mjs). El resto de fronts lo consume
// cross-origin; CORS ya los autoriza.
const webClientBlock = (upstream) => `${headerBlock}${bodyLimit}\tencode zstd gzip
	@api path ${API_PATHS.join(" ")}
	handle @api {
		reverse_proxy ${BACKEND}${protoUp}
	}
	handle {
		reverse_proxy ${upstream}${protoUp}
	}`;

// Host del API cuando ya existe HOST_WEB: sirve TODO el backend. Los frontends
// se compilan con VITE_API_URL=https://api... y necesitan todas las rutas
// (/catalog, /orders, /auth, ...). Se conserva el rewrite de la raíz para las
// pasarelas configuradas con el host pelado (Wompi).
const apiHostBlock = `${headerBlock}${bodyLimit}\tencode zstd gzip
	handle / {
		rewrite * /webhooks/wompi
		reverse_proxy ${BACKEND}${protoUp}
	}
	handle {
		reverse_proxy ${BACKEND}${protoUp}
	}`;

const staticBlock = (upstream, withAuth) => `${headerBlock}${withAuth ? basicAuth : ""}${bodyLimit}\tencode zstd gzip
	reverse_proxy ${upstream}${protoUp}`;

let out = "";

if (anyHost) {
  const opts = [
    "\tadmin off",
    `\thttp_port ${HTTP_PORT}`,
    "\tauto_https off",
    // Detrás del edge compartido: el edge es un proxy de confianza (red Docker
    // privada) y envía el X-Forwarded-For del cliente; sin esto Caddy lo
    // reemplazaría por la IP del edge y el rate limit sería un único cubo.
    "\tservers {\n\t\ttrusted_proxies static private_ranges\n\t}",
  ];
  out += `{\n${opts.join("\n")}\n}\n`;

  if (apiHosts.length > 0 && !apiHosts.includes(HOST_WEB)) {
    out += `\n${apiHosts.map((h) => `http://${h}`).join(", ")} {\n${apiHostBlock}\n}\n`;
  }
  for (const f of frontHosts) {
    const withAuth = PROTECT_ADMIN && Boolean(f.admin) && Boolean(basicAuth);
    const block = f.web ? webClientBlock(f.upstream) : staticBlock(f.upstream, withAuth);
    out += `\n${f.hosts.map((h) => `http://${h}`).join(", ")} {\n${block}\n}\n`;
  }
} else {
  // Sin dominios configurados: vhost mínimo en el puerto HTTP (solo API).
  out +=
    `# ⚠️  No definiste ningún HOST_* — vhost mínimo (solo API).\n` +
    `#     Define HOST_API y HOST_WEB/HOST_ADMIN/... para publicar las interfaces.\n` +
    `:${HTTP_PORT} {\n${apiBlock}\n}\n`;
}

const dest = env.CADDYFILE_OUT || "/config/Caddyfile.generated";
fs.writeFileSync(dest, out);
process.stdout.write(`Caddyfile generado en ${dest}:\n${out}`);
