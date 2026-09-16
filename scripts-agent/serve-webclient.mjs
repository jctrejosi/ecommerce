/**
 * Sirve el build de producción de `Interface web client/dist` y actúa como
 * mismo-origen para el API, de modo que la web (dentro del WebView del APK
 * cliente) funcione en cualquier red/IP sin CORS ni URLs fijas.
 *
 * Rutas:
 *  - `GET /discovery`            → JSON con el identificador del servicio (lo
 *                                  usa el APK para encontrar el servidor en la LAN).
 *  - `/ofm/*`                    → tiles de OpenFreeMap (mapa de rastreo).
 *  - API (`/catalog/…`, `/landing/…`, `/orders`, `/cart`, `/customer-auth/…`,
 *    `/socket.io/*`, …)          → proxy a 127.0.0.1:3000 (backend NestJS).
 *  - Bot (`/chat…`)              → proxy a 127.0.0.1:8000 (FastAPI del bot).
 *  - Resto                       → estáticos de `dist` con SPA fallback.
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/serve-webclient.mjs [port]      (por defecto 4173)
 */
import http from "node:http";
import https from "node:https";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "Interface web client",
  "dist",
);
const PORT = Number(process.argv[2] || 4173);
const HOST = "0.0.0.0";

const BACKEND = {
  host: "127.0.0.1",
  // Se puede apuntar a otra instancia del backend (p. ej. BACKEND_PORT=3001
  // cuando el 3000 lo ocupa otro proyecto).
  port: Number(process.env.BACKEND_PORT || 3000),
};
const BOT = { host: "127.0.0.1", port: 8000 };

/** Identificador que devuelve `/discovery` (lo espera el APK cliente). */
const SERVICE_ID = "mercaldas-webclient";

/** Rutas de API que se enrutan al backend por coincidencia exacta. */
const API_EXACT = new Set([
  "/banners",
  "/orders",
  "/cart",
  "/notifications",
  "/api-status",
  "/payments/methods",
]);

/** Prefijos (con subruta) que se enrutan al backend. */
const API_PREFIXES = [
  "/catalog/",
  "/landing/",
  "/geocode/",
  "/popups/",
  "/featured/",
  "/orders/",
  "/customer-auth/",
  "/cart/",
  "/payments/",
  "/newsletter/",
  "/qr/",
  "/notifications/",
  "/upload/",
  "/admin/",
  "/socket.io/",
];

/** Prefijos del bot de compras (FastAPI). */
const BOT_PREFIXES = ["/chat"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".csv": "text/csv; charset=utf-8",
};

/**
 * Cabeceras de caché de los estáticos.
 *
 * El HTML **nunca** se cachea: si el WebView guarda un `index.html` viejo, sigue
 * pidiendo el bundle anterior y un build nuevo no se ve aunque se recargue. Los
 * archivos de `assets/` llevan hash en el nombre, así que sí son inmutables.
 */
function cacheHeaders(pathname) {
  if (pathname.startsWith("/assets/")) {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }
  return { "Cache-Control": "no-cache" };
}

function isApiPath(pathname) {
  return (
    API_EXACT.has(pathname) ||
    API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    BOT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

function upstreamFor(pathname) {
  return BOT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    ? BOT
    : BACKEND;
}

/** Proxy HTTP simple hacia el backend/bot. */
function proxyHttp(req, res, target) {
  const opts = {
    hostname: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${target.host}:${target.port}`,
    },
  };
  const up = http.request(opts, (ur) => {
    res.writeHead(ur.statusCode || 502, ur.headers);
    ur.pipe(res);
  });
  up.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ error: "bad gateway", detail: e.message }));
  });
  // El cliente (el WebView) puede cortar la petición en cualquier momento
  // (p. ej. al cambiar de red). Sin estos manejadores el proceso muere.
  req.on("error", () => up.destroy());
  res.on("error", () => up.destroy());
  req.pipe(up);
}

/** Proxy de tiles de OpenFreeMap. */
function proxyOfm(req, res, upstreamPath) {
  const up = https.request(
    {
      hostname: "tiles.openfreemap.org",
      port: 443,
      path: upstreamPath,
      method: req.method,
      headers: { "User-Agent": "mercaldas-webclient", Accept: req.headers.accept || "*/*" },
    },
    (ur) => {
      res.writeHead(ur.statusCode || 200, {
        "Content-Type": ur.headers["content-type"] || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      });
      ur.pipe(res);
    },
  );
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("bad gateway");
  });
  req.on("error", () => up.destroy());
  res.on("error", () => up.destroy());
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/discovery") {
    // Única ruta que se registra: es la que usa el APK para encontrarnos.
    console.log(
      `${new Date().toISOString()} discovery ← ${req.socket.remoteAddress}`,
    );
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    return res.end(
      JSON.stringify({
        service: SERVICE_ID,
        name: "Mercaldas",
        port: PORT,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  if (pathname.startsWith("/ofm/")) {
    return proxyOfm(req, res, pathname.replace(/^\/ofm/, ""));
  }

  if (isApiPath(pathname)) {
    return proxyHttp(req, res, upstreamFor(pathname));
  }

  let filePath = normalize(
    join(ROOT, pathname === "/" ? "index.html" : pathname),
  );
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("forbidden");
  }

  try {
    const st = await stat(filePath);
    if (st.isFile()) {
      const data = await readFile(filePath);
      const isHtml = extname(filePath) === ".html";
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
        ...(isHtml ? { "Cache-Control": "no-store" } : cacheHeaders(pathname)),
      });
      return res.end(data);
    }
  } catch {
    /* no existe → SPA fallback */
  }

  try {
    const html = await readFile(join(ROOT, "index.html"));
    res.writeHead(200, {
      "Content-Type": MIME[".html"],
      "Cache-Control": "no-store",
    });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end("dist no encontrado: ejecuta `npm run build` en Interface web client");
  }
});

/** WebSockets (socket.io) hacia el backend. */
server.on("upgrade", (req, socket, head) => {
  // El socket crudo de un `upgrade` no tiene manejador por defecto: si el
  // cliente lo corta de golpe (p. ej. al cambiar de red) y no lo capturamos,
  // el `error` sin manejar tumba todo el proceso.
  socket.on("error", () => socket.destroy());

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (!pathname.startsWith("/socket.io/")) {
    socket.destroy();
    return;
  }
  const up = http.request({
    hostname: BACKEND.host,
    port: BACKEND.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${BACKEND.host}:${BACKEND.port}` },
  });
  up.on("upgrade", (ur, upSocket, upHead) => {
    upSocket.on("error", () => socket.destroy());
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(ur.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n")}\r\n\r\n`,
    );
    if (upHead?.length) socket.unshift(upHead);
    upSocket.pipe(socket).pipe(upSocket);
  });
  up.on("error", () => socket.destroy());
  up.end();
});

/** Peticiones malformadas: se descartan sin tumbar el servidor. */
server.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  else socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(
    `Web client servido en http://${HOST}:${PORT} (SPA + API bot :${BACKEND.port} + bot :${BOT.port} + /ofm + /discovery)`,
  );
});

// Última red de seguridad: un servidor de larga vida no debe morir por un error
// de un socket concreto. Se registra y se sigue sirviendo.
process.on("uncaughtException", (err) => {
  console.error(`[serve-webclient] uncaughtException: ${err?.message || err}`);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[serve-webclient] unhandledRejection: ${reason}`);
});
