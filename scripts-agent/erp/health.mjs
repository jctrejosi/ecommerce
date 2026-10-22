/**
 * Healthcheck del conector ERP ⇄ Postgres.
 *
 * Verifica, sin volcar datos:
 *   - Postgres del ecommerce y outbox pendiente.
 *   - Dominios de `erp_code_map`.
 *   - OpenADS (HTTP /api/health).
 *   - Acceso de lectura a las tablas clave de FORTUNER.
 *
 * Uso:
 *   node scripts-agent/erp/health.mjs
 *   OPENADS_URL=http://192.168.1.50:18080 node scripts-agent/erp/health.mjs
 *
 * Sale con código 1 si algún chequeo falla (sirve para el servicio/CI).
 */
import { createErpClient, createPg } from './openads.mjs';
import { args, log } from './lib.mjs';

const a = args();
const JSON_OUT = !!a.json;

const checks = [];
const add = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
};

const pg = createPg();
const erp = createErpClient();

try {
  await pg.connect();
  const db = (await pg.query('SELECT current_database() AS db')).rows[0]?.db;
  add('postgres', true, `db=${db}`);

  const outbox = (
    await pg.query(
      "SELECT kind, count(*)::int AS n FROM erp_outbox WHERE status='pending' GROUP BY 1 ORDER BY 1",
    )
  ).rows;
  add('erp_outbox', true, outbox.map((r) => `${r.kind}=${r.n}`).join(' ') || 'sin pendientes');

  const map = (
    await pg.query('SELECT domain, count(*)::int AS n FROM erp_code_map GROUP BY 1 ORDER BY 1')
  ).rows;
  add('erp_code_map', map.length > 0, map.map((r) => `${r.domain}=${r.n}`).join(' '));
} catch (e) {
  add('postgres', false, e.message);
}

try {
  const h = await erp.health();
  add('openads', h.status === 'ok', `${erp.config.baseUrl} · engine=${h.engine || '?'} · data=${h.data_dir || '?'}`);
} catch (e) {
  add('openads', false, `${erp.config.baseUrl} · ${e.message}`);
}

const TABLES = [
  ['tidsal', 'INARTIC'],
  ['domdia', 'FACONTROL'],
  ['domite', 'IFPEDIDO'],
  ['pospago', 'CODIGO'],
  ['tidmarcas', 'MCODIGO'],
  ['tidtpro', 'CODIGO'],
  ['tidbode', 'CODIGO'],
];
for (const [table, key] of TABLES) {
  try {
    const res = await erp.sql(`SELECT ${key} FROM ${table}`, 1);
    add(`tabla:${table}`, true, `lectura ok (${res.rows.length} fila)`);
  } catch (e) {
    add(`tabla:${table}`, false, e.message);
  }
}

try {
  await pg.end();
} catch {
  /* noop */
}

const failed = checks.filter((c) => !c.ok);
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 1));
} else {
  log(`Conector ERP — ${erp.config.baseUrl} (usuario ${erp.config.user})`);
  for (const c of checks) log(`  ${c.ok ? '✅' : '❌'} ${c.name.padEnd(18)} ${c.detail}`);
  log(`\n${failed.length ? `❌ ${failed.length} chequeo(s) con error` : '✅ Todo listo'}`);
}
process.exit(failed.length ? 1 : 0);
