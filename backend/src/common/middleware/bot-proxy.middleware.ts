import { Request, Response } from 'express';

/**
 * Proxy interno hacia el bot FastAPI (`127.0.0.1:8001`).
 *
 * El bot deja de estar expuesto por Caddy: todas las peticiones `/bot/*`
 * entran al backend y este las reenvía por loopback. Así el bot solo es
 * alcanzable desde el propio proceso backend del contenedor.
 *
 * - Conserva método, ruta, query y cuerpo JSON.
 * - Reenvía X-Forwarded-For para que el rate limit del bot identifique al
 *   cliente (según lo que permita el proxy de entrada).
 * - Elimina cabeceras hop-by-hop y las de CORS del bot; CORS lo aplica el
 *   backend sobre la respuesta final.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
]);

const TIMEOUT_MS = Number(process.env.BOT_PROXY_TIMEOUT_MS ?? 90000);

export function createBotProxyMiddleware() {
  const base =
    process.env.BOT_INTERNAL_URL ||
    `http://127.0.0.1:${process.env.BOT_PORT || 8001}`;
  const target = base.replace(/\/+$/, '');

  return async (req: Request, res: Response): Promise<void> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const k = key.toLowerCase();
      if (HOP_BY_HOP.has(k)) continue;
      if (k.startsWith('access-control-')) continue;
      if (k === 'origin' || k === 'referer') continue;
      headers[k] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      headers['x-forwarded-for'] = Array.isArray(forwarded)
        ? forwarded.join(', ')
        : forwarded;
    } else if (req.ip) {
      headers['x-forwarded-for'] = req.ip;
    }

    let body: string | undefined;
    if (!['GET', 'HEAD'].includes(req.method) && req.body !== undefined) {
      body =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      headers['content-type'] = headers['content-type'] || 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const upstream = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (HOP_BY_HOP.has(k) || k.startsWith('access-control-')) return;
        res.setHeader(key, value);
      });
      const retryAfter = upstream.headers.get('retry-after');
      if (retryAfter) res.setHeader('Retry-After', retryAfter);

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[bot-proxy] ${req.method} ${req.url}: ${message}`);
      if (!res.headersSent) {
        res.status(502).json({ detail: 'Bot no disponible' });
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
