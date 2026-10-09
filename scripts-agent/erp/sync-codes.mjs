/**
 * Puebla `erp_code_map` con los códigos del ERP (POSPAGO, TIDTIPOS, POSDANE,
 * TIDBODE, TIDMARCAS, TIDTPRO). Nada se interpreta luego con un "if".
 *
 * Uso: node scripts-agent/erp/sync-codes.mjs
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, log } from './lib.mjs';

const erp = createErpClient();
const pg = createPg();

const FUENTES = [
  {
    domain: 'payment_method',
    table: 'pospago',
    sql: 'SELECT CODIGO, NOMBRE, NOMBRE2, SUCUR, PERMIDSI, VALIDAWEB FROM pospago',
    key: (r) => s(r[0]),
    label: (r) => s(r[1]),
    meta: (r) => ({ nombre2: s(r[2]), sucur: s(r[3]), permidsi: r[4], validawweb: r[5] }),
  },
  {
    domain: 'tax',
    table: 'tidtipos',
    sql: 'SELECT CLASE, TIPO, NOMBRE, IMPUESTO, BASE FROM tidtipos',
    key: (r) => `${s(r[0])}-${s(r[1])}`,
    label: (r) => s(r[2]),
    meta: (r) => ({ clase: s(r[0]), tipo: s(r[1]), impuesto: s(r[3]), base: s(r[4]) }),
  },
  {
    domain: 'city',
    table: 'posdane',
    sql: 'SELECT CODIGO, NOMBRE FROM posdane',
    key: (r) => s(r[0]),
    label: (r) => s(r[1]),
    meta: () => ({}),
  },
  {
    domain: 'warehouse',
    table: 'tidbode',
    sql: 'SELECT CODIGO, NOMBRE FROM tidbode',
    key: (r) => s(r[0]),
    label: (r) => s(r[1]),
    meta: () => ({}),
  },
  {
    domain: 'brand',
    table: 'tidmarcas',
    sql: 'SELECT MCODIGO, MNOMBRE FROM tidmarcas',
    key: (r) => s(r[0]),
    label: (r) => s(r[1]),
    meta: () => ({}),
  },
  {
    domain: 'product_type',
    table: 'tidtpro',
    sql: 'SELECT CODIGO, NOMBRE, HABILITA FROM tidtpro',
    key: (r) => s(r[0]),
    label: (r) => s(r[1]),
    meta: (r) => ({ habilita: r[2] }),
  },
];

await pg.connect();
try {
  for (const f of FUENTES) {
    let res;
    try {
      res = await erp.sql(f.sql, 5000);
    } catch (e) {
      log(`  ! ${f.domain}: ${e.message}`);
      continue;
    }
    const seen = new Map();
    for (const row of res.rows) {
      const code = f.key(row);
      if (!code) continue;
      if (seen.has(code)) continue;
      seen.set(code, { label: f.label(row), meta: f.meta(row) });
    }
    for (const [code, v] of seen) {
      // Un `erp_value` = un `canonical` para los dominios del ERP. La PK es
      // (domain, erp_value, canonical), así que borramos antes para no dejar
      // filas obsoletas si el nombre del ERP cambió entre corridas.
      await pg.query('DELETE FROM erp_code_map WHERE domain=$1 AND erp_value=$2', [f.domain, code]);
      await pg.query(
        `INSERT INTO erp_code_map (domain, erp_value, canonical, label, meta)
         VALUES ($1,$2,$3,$4,$5)`,
        [f.domain, code, (v.label || code).toUpperCase(), v.label, JSON.stringify(v.meta)],
      );
    }
    log(`  ${f.domain.padEnd(16)} ${String(seen.size).padStart(5)} códigos  (${f.table})`);
  }
  const t = await pg.query('SELECT domain, count(*) n FROM erp_code_map GROUP BY 1 ORDER BY 2 DESC');
  log('\nerp_code_map:');
  for (const r of t.rows) log(`  ${r.domain.padEnd(16)} ${r.n}`);
} finally {
  await pg.end();
}
