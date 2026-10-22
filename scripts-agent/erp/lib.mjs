/**
 * Utilidades compartidas del conector ERP.
 *   - Carga .env del backend (DATABASE_URL).
 *   - Codecs del formato Advantage (latin1, centinelas, fechas YYYYMMDD...).
 *   - Hash de fila y parseo de argumentos.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

const require = createRequire(import.meta.url);
const dotenv = require(path.join(ROOT, 'backend/node_modules/dotenv'));

// Producción: backend/.env.production o backend/.env; desarrollo: .env.development.local.
// DOTENV_CONFIG_PATH permite apuntar a un archivo explícito al desplegar.
const envFiles = process.env.DOTENV_CONFIG_PATH
  ? [process.env.DOTENV_CONFIG_PATH]
  : process.env.NODE_ENV === 'production'
    ? ['backend/.env.production', 'backend/.env']
    : ['backend/.env.development.local', 'backend/.env'];
for (const rel of envFiles) {
  const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
}

/** Sucursal del ERP ("1","2","11") -> branches.code en Postgres.
 *  asqlcmd entrega los numéricos como "1.000000000000000". */
export const BRANCH_CODE = (insuc) => {
  const raw = String(insuc ?? '').trim();
  const num = Number(raw);
  if (Number.isFinite(num)) return String(Math.trunc(num));
  return raw.replace(/^0+/, '') || '0';
};

/** char(n): limpiar relleno. El API ya entrega string. */
export const s = (v) => (v == null ? null : String(v).trim());

/** Recorta a n caracteres (para columnas char(n) del ERP). */
export const clip = (v, n) => (v == null ? '' : String(v)).slice(0, n);

/**
 * Número de pedido web → DOMDIA.FAPEDIDO / DOMITE.IFPEDIDO.
 *
 * Ambas columnas se enlazan por este valor y `IFPEDIDO` es char(9), así que el
 * número debe medir exactamente 9. Prefijo propio del canal web (por defecto
 * '9') + id secuencial. Ej.: id 510 → '900000510'.
 */
export function orderNumber(id) {
  const prefix = process.env.ERP_ORDER_PREFIX ?? '9';
  const width = 9 - prefix.length;
  const n = String(id);
  if (width < 1 || n.length > width) {
    throw new Error(`orderNumber: id ${id} no cabe con prefijo '${prefix}' en char(9)`);
  }
  return prefix + n.padStart(width, '0');
}

/**
 * Código nuevo para una maestra del ERP, con la longitud exacta de la columna.
 * Por defecto usa el rango numérico 9xxxxxxx (no colisiona con las maestras
 * existentes, que son códigos numéricos cortos).
 */
export function newErpCode(id, length) {
  const prefix = process.env.ERP_NEW_CODE_PREFIX ?? '9';
  const width = length - prefix.length;
  const n = String(id);
  if (width < 1 || n.length > width) {
    throw new Error(`newErpCode: id ${id} no cabe en char(${length}) con prefijo '${prefix}'`);
  }
  return prefix + n.padStart(width, '0');
}

/** numérico: '' / centinelas -> null. */
export function n(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  if (!Number.isFinite(x)) return null;
  if (x === -2147483648) return null;          // int32 vacío
  if (Math.abs(x) < 1e-300 && x !== 0) return null; // double vacío
  return x;
}

/** fecha "YYYYMMDD" -> Date | null */
export function d(v) {
  const x = s(v);
  if (!x || x === '0' || !/^\d{8}$/.test(x)) return null;
  const y = x.slice(0, 4), m = x.slice(4, 6), dd = x.slice(6, 8);
  const dt = new Date(`${y}-${m}-${dd}T00:00:00-05:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export const sha1 = (obj) =>
  crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');

/** Parseo simple de flags: --apply --limit=100 */
export function args() {
  const out = { _: [] };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else out._.push(a);
  }
  return out;
}

export function log(...a) {
  console.log(...a);
}
