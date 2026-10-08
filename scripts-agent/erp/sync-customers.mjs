/**
 * Sincroniza clientes del ERP (Advantage `POSCLI`) hacia Postgres (`customers`).
 *
 *   ERP (POSCLI)  →  customers
 *
 * Mismo modelo que sync-catalog.mjs: **diff por huella** contra `erp_snapshot`
 * (`erp_table='POSCLI'`) y **merge NO destructivo** (COALESCE: el ERP solo
 * sobrescribe un campo cuando trae valor; si no, se conserva lo que haya en
 * Postgres). No toca ninguna otra tabla.
 *
 * Mapeo: docs/PLAN-INTEGRACION-ERP.md §4.3 / docs/INTEGRACION-ERP-ADVANTAGE.md §4.1.
 *
 * Detalles:
 *   - Identidad: `CODCLI` (13) → `erp_customer_code` y `provider_id` (provider='ERP').
 *   - `customers.email` es NOT NULL y UNIQUE → si el ERP no trae email (o choca con
 *     otro cliente) se sintetiza `<CODCLI>@erp.mercaldas.local`.
 *   - `FECHABAJA` está poblado en casi todas las filas y su significado no está
 *     confirmado (ver §7/§10.8 del doc de descubrimiento) → **no se usa**.
 *
 * Uso:
 *   node scripts-agent/erp/sync-customers.mjs --dry-run
 *   node scripts-agent/erp/sync-customers.mjs --limit=1000
 *   node scripts-agent/erp/sync-customers.mjs                    # todos los cambios
 *   node scripts-agent/erp/sync-customers.mjs --only-web         # solo ORIGENW='W'
 *   node scripts-agent/erp/sync-customers.mjs --reset-snapshot    # re-sincroniza todo
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log, sha1 } from './lib.mjs';

const a = args();
const DRY = !!a['dry-run'];
const RESET_SNAP = !!a['reset-snapshot'];
const ONLY_WEB = !!a['only-web'];
const LIMIT = a.limit ? Number(a.limit) : Infinity;
const PAGE = Number(a.page || 3000);

const EMAIL_DOMAIN = 'erp.mercaldas.local';
const synth = (codcli) => `${codcli}@${EMAIL_DOMAIN}`;

const COLS = [
  'CODCLI', 'ORIGENW', 'NOMCLI', 'NOMBRE', 'NOMBRE2', 'APELLIDO', 'APELLIDO2',
  'CEDCLI', 'TIPODOC', 'EMAIL', 'TELCELU', 'TELCLI1', 'TELCLI2', 'BLOQUE',
  'SUCURSAL', 'CIUDAD',
];
const SQL = `SELECT ${COLS.join(', ')} FROM poscli${ONLY_WEB ? " WHERE ORIGENW = 'W'" : ''}`;

// ─────────────────────────────── helpers ───────────────────────────────

async function insertBatches(pg, table, cols, rows, conflict = '') {
  const CHUNK = 400;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const tuples = [];
    const params = [];
    let idx = 0;
    for (const row of chunk) {
      tuples.push('(' + row.map(() => `$${++idx}`).join(',') + ')');
      params.push(...row);
    }
    await pg.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflict}`,
      params,
    );
    done += chunk.length;
  }
  return done;
}

const nonZero = (v) => {
  const x = s(v);
  return x && x !== '0' ? x : null;
};

function splitName(r) {
  let first = [s(r.NOMBRE), s(r.NOMBRE2)].filter(Boolean).join(' ').trim();
  let last = [s(r.APELLIDO), s(r.APELLIDO2)].filter(Boolean).join(' ').trim();
  if (!first && !last) {
    const parts = (s(r.NOMCLI) || '').split(/\s+/).filter(Boolean);
    first = parts.shift() || '';
    last = parts.join(' ');
  }
  return [first || null, last || null];
}

// ─────────────────────────────── lectura ───────────────────────────────

const erp = createErpClient();
const pg = createPg();
await pg.connect();
const q = (t, p) => pg.query(t, p);

log(`⏳ Leyendo POSCLI (${COLS.length} columnas)${ONLY_WEB ? " [solo ORIGENW='W']" : ''}…`);
const byCodcli = new Map();
const hashes = new Map();
let read = 0;
let offset = 0;
for (;;) {
  const res = await erp.sql(SQL, { limit: PAGE, offset });
  const { cols, rows } = res;
  if (!rows.length) break;
  const ix = new Map(cols.map((c, i) => [c, i]));
  for (const row of rows) {
    const codcli = s(row[ix.get('CODCLI')]);
    if (!codcli) continue;
    read++;
    const vals = COLS.map((c) => s(row[ix.get(c)]));
    hashes.set(codcli, sha1(vals));
    byCodcli.set(codcli, Object.fromEntries(COLS.map((c, i) => [c, vals[i]])));
    if (read >= LIMIT) break;
  }
  if (read >= LIMIT || rows.length < PAGE) break;
  offset += rows.length;
}
log(`   ${read} clientes | ${byCodcli.size} CODCLI`);

// ─────────────────────────── diff vs erp_snapshot ───────────────────────────

if (RESET_SNAP && !DRY) await q("DELETE FROM erp_snapshot WHERE erp_table = 'POSCLI'");
const snap = new Map(
  (await q("SELECT erp_key, hash FROM erp_snapshot WHERE erp_table = 'POSCLI'")).rows.map((r) => [r.erp_key, r.hash]),
);
const todo = [...hashes.entries()].filter(([k, h]) => snap.get(k) !== h).map(([k]) => k);
log(`   cambios: ${todo.length} de ${hashes.size}`);

if (DRY) {
  log('\n🧪 DRY-RUN — nada escrito.');
  log(`   clientes a tocar : ${todo.length}`);
  await pg.end();
  process.exit(0);
}

// ─────────────────── emails existentes (evitar choques UNIQUE) ───────────────────

const existing = (
  await q("SELECT lower(email) AS e, erp_customer_code FROM customers WHERE deleted_at IS NULL")
).rows;
const emailOwner = new Map(existing.map((r) => [r.e, r.erp_customer_code]));

// ─────────────────────────── construir filas ───────────────────────────

const cols = [
  'email', 'erp_customer_code', 'provider', 'provider_id', 'first_name',
  'last_name', 'document_number', 'document_type', 'phone', 'is_active', 'updated_at',
];
const now = new Date().toISOString();
const out = [];
for (const codcli of todo) {
  const r = byCodcli.get(codcli);
  const [first, last] = splitName(r);
  const real = s(r.EMAIL);
  let email = real || synth(codcli);
  if (real && emailOwner.has(email.toLowerCase()) && emailOwner.get(email.toLowerCase()) !== codcli)
    email = synth(codcli);
  emailOwner.set(email.toLowerCase(), codcli);
  out.push([
    email, codcli, 'ERP', codcli, first, last,
    s(r.CEDCLI) || null, s(r.TIPODOC) || null,
    nonZero(r.TELCELU) || nonZero(r.TELCLI1) || nonZero(r.TELCLI2),
    s(r.BLOQUE) !== 'T',
    now,
  ]);
}

// ─────────────────────────── upsert ───────────────────────────

const conflict = `ON CONFLICT (erp_customer_code) WHERE (erp_customer_code IS NOT NULL) DO UPDATE SET
  first_name = COALESCE(EXCLUDED.first_name, customers.first_name),
  last_name = COALESCE(EXCLUDED.last_name, customers.last_name),
  document_number = COALESCE(EXCLUDED.document_number, customers.document_number),
  document_type = COALESCE(EXCLUDED.document_type, customers.document_type),
  phone = COALESCE(EXCLUDED.phone, customers.phone),
  email = COALESCE(NULLIF(EXCLUDED.email, customers.erp_customer_code || '@${EMAIL_DOMAIN}'), customers.email),
  provider = EXCLUDED.provider,
  provider_id = COALESCE(EXCLUDED.provider_id, customers.provider_id),
  is_active = EXCLUDED.is_active,
  updated_at = EXCLUDED.updated_at`;

log(`⏳ Upsert de ${out.length} clientes…`);
await insertBatches(pg, 'customers', cols, out, conflict);

// ─────────────────────────── snapshot ───────────────────────────

log('⏳ Actualizando erp_snapshot…');
const snapRows = [...hashes.entries()];
const CH = 500;
for (let i = 0; i < snapRows.length; i += CH) {
  const chunk = snapRows.slice(i, i + CH);
  let idx = 0;
  const params = [];
  const tuples = chunk.map(([k, h]) => {
    params.push(k, h, 'POSCLI');
    return `($${++idx},$${++idx},$${++idx},now())`;
  });
  await pg.query(
    `INSERT INTO erp_snapshot (erp_key, hash, erp_table, synced_at)
     VALUES ${tuples.join(',')}
     ON CONFLICT (erp_key, erp_table) DO UPDATE SET hash=EXCLUDED.hash, synced_at=now()`,
    params,
  );
}

// ─────────────────────────── resumen ───────────────────────────

const counts = (
  await q(`SELECT (SELECT count(*)::int FROM customers) customers,
                  (SELECT count(*)::int FROM customers WHERE provider='ERP') erp_customers`)
).rows[0];
log('\n✅ Sync clientes terminado');
log(counts);
log(`   leídos: ${read} | a tocar: ${todo.length}`);
await pg.end();
