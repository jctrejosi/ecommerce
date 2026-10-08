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
require(path.join(ROOT, 'backend/node_modules/dotenv')).config({
  path: path.join(ROOT, 'backend/.env.development.local'),
});

/** Sucursal del ERP ("1","2","11") -> branches.code en Postgres. */
export const BRANCH_CODE = (insuc) => String(String(insuc).trim()).replace(/^0+/, '') || '0';

/** char(n): limpiar relleno. El API ya entrega string. */
export const s = (v) => (v == null ? null : String(v).trim());

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
