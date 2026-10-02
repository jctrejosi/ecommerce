import * as path from 'path';

/**
 * Raíz de los estáticos locales.
 *
 * Por defecto `<repo>/db`, asumiendo que el proceso corre con cwd `backend/`
 * (así arranca en dev y en el contenedor). Se puede fijar otra ruta con
 * `MEDIA_STATIC_DIR` (útil si en producción se monta un volumen).
 */
export function resolveMediaStaticRoot(): string {
  return process.env.MEDIA_STATIC_DIR
    ? path.resolve(process.env.MEDIA_STATIC_DIR)
    : path.resolve(process.cwd(), '..', 'db');
}

/**
 * Normaliza una ruta tipo `delivery/drivers/12` para usarla como subcarpeta
 * segura (sin `..`, sin caracteres raros) bajo `images_static/uploads`.
 */
export function sanitizeMediaFolder(folder: string): string {
  return folder
    .split('/')
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, '_'))
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}
