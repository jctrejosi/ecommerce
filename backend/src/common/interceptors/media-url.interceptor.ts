import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Convierte las rutas locales `/static/...` que devuelve la API en URLs
 * absolutas del host por el que entró la petición.
 *
 * En la BD `media.path` apunta al archivo en disco (`/static/products/x.jpg`,
 * `/static/media/uploads/...`), de modo que no dependemos de Cloudinary ni de
 * la IP del equipo. El frontend sigue recibiendo URLs listas para usar, sin
 * cambios en ningún cliente.
 *
 * `PUBLIC_MEDIA_BASE_URL` permite forzar la base (p. ej. detrás de un proxy).
 */
@Injectable()
export class MediaUrlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const base = resolveBaseUrl(req);

    return next
      .handle()
      .pipe(map((data: unknown) => prefixLocalMediaPaths(data, base)));
  }
}

export const LOCAL_MEDIA_PREFIX = '/static/';

function resolveBaseUrl(req: any): string {
  const override = process.env.PUBLIC_MEDIA_BASE_URL;
  if (override) return override.replace(/\/+$/, '');

  const firstHeader = (value: unknown): string | undefined => {
    if (Array.isArray(value)) return String(value[0] ?? '');
    if (typeof value === 'string') return value;
    return undefined;
  };

  const proto =
    firstHeader(req.headers?.['x-forwarded-proto'])?.split(',')[0]?.trim() ||
    req.protocol ||
    'http';
  const host =
    firstHeader(req.headers?.['x-forwarded-host'])?.split(',')[0]?.trim() ||
    req.get?.('host') ||
    `localhost:${process.env.PORT ?? 3000}`;

  return `${proto}://${host}`;
}

function prefixLocalMediaPaths(value: unknown, base: string): unknown {
  if (typeof value === 'string') {
    return value.startsWith(LOCAL_MEDIA_PREFIX) ? `${base}${value}` : value;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const rewritten = prefixLocalMediaPaths(item, base);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return changed ? out : value;
  }

  if (isWalkableObject(value)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const rewritten = prefixLocalMediaPaths(item, base);
      if (rewritten !== item) changed = true;
      out[key] = rewritten;
    }
    return changed ? out : value;
  }

  return value;
}

function isWalkableObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof Date) return false;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return false;
  if (typeof (value as { pipe?: unknown }).pipe === 'function') return false;
  return true;
}
