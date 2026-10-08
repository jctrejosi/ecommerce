/**
 * Cliente del conector ERP (OpenADS).
 *
 * Habla con el servidor OpenADS por su API HTTP (consola Studio). Es el ÚNICO
 * punto que conoce el transporte: cuando se conecte la BD real del ERP, basta
 * con cambiar OPENADS_URL / OPENADS_USER / OPENADS_PASS.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { Client } = require(resolve('backend/node_modules/pg'));

export const ERP_CONFIG = {
  baseUrl: process.env.OPENADS_URL || 'http://localhost:18080',
  user: process.env.OPENADS_USER || 'dsi',
  pass: process.env.OPENADS_PASS || 'dsi',
};

export function createErpClient(cfg = ERP_CONFIG) {
  const auth =
    'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');

  async function call(method, path, body) {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: body
        ? { Authorization: auth, 'Content-Type': 'application/json' }
        : { Authorization: auth },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `ERP ${method} ${path}: respuesta no JSON (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    if (!res.ok || json.error) {
      throw new Error(`ERP ${method} ${path}: ${json.error || res.status}`);
    }
    return json;
  }

  return {
    config: cfg,
    health: () => call('GET', '/api/health'),
    schema: (table) =>
      call('GET', `/api/tables/${encodeURIComponent(table)}/schema`),
    rows: (table, { offset = 0, limit = 100 } = {}) =>
      call(
        'GET',
        `/api/tables/${encodeURIComponent(table)}/rows?offset=${offset}&limit=${limit}`,
      ),
    /** Ejecuta SQL. La tabla en el FROM va sin extensión (ej. TIDSAL).
     *  Firma: sql(sql, limit)  |  sql(sql, { limit, offset }). */
    sql: (sql, opts = 200) => {
      const o = typeof opts === 'number' ? { limit: opts } : opts || {};
      return call('POST', '/api/sql', {
        sql,
        limit: o.limit ?? 200,
        offset: o.offset ?? 0,
      });
    },
    insert: (table, values) =>
      call('POST', `/api/tables/${encodeURIComponent(table)}/insert`, values),
    update: (table, recno, values) =>
      call(
        'POST',
        `/api/tables/${encodeURIComponent(table)}/update?recno=${recno}`,
        values,
      ),
    remove: (table, recno) =>
      call('POST', `/api/tables/${encodeURIComponent(table)}/delete?recno=${recno}`),
  };
}

/** Conexión a la base Postgres del ecommerce. */
export function createPg() {
  return new Client({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
}
