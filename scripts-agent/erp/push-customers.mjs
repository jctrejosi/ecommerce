/**
 * Clientes del ecommerce → ERP (Advantage `POSCLI`) — alta y actualización.
 *
 *   customers (Postgres)  →  POSCLI (ERP)
 *
 * - Si el cliente no tiene `erp_customer_code`: se **crea** en POSCLI y se guarda
 *   el `CODCLI` de vuelta.
 * - Si ya lo tiene y sus datos cambiaron (hash): se **actualiza** en POSCLI.
 *
 * El ERP es el dueño del `CODCLI`; mientras se confirma su algoritmo (§11) se
 * genera con `newErpCode(id, 13)` (prefijo '9' + secuencia). Escritura gateada:
 * por defecto **dry-run**; escribe sólo con `--apply`.
 *
 * Uso:
 *   node scripts-agent/erp/push-customers.mjs
 *   node scripts-agent/erp/push-customers.mjs --apply --limit=50
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log, sha1, clip, newErpCode } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LIMIT = a.limit ? Number(a.limit) : 200;
const SUCURSAL = process.env.ERP_CUSTOMER_SUCURSAL || '01';
const TIPODOC = process.env.ERP_CUSTOMER_TIPODOC || '13';

const lit = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;

const erp = createErpClient();
const pg = createPg();
await pg.connect();
await pg.query("SET app.erp_sync = 'on'"); // no reencolar lo que subimos
const q = (t, p) => pg.query(t, p);

const rows = (
  await q(
    `SELECT id, first_name, last_name, document_number, document_type, phone, email, erp_customer_code
       FROM customers
      WHERE deleted_at IS NULL AND provider = 'local'
      ORDER BY id
      LIMIT $1`,
    [LIMIT],
  )
).rows;

const snap = new Map(
  (await q("SELECT erp_key, hash FROM erp_snapshot WHERE erp_table='PG_CUSTOMER'")).rows.map((r) => [r.erp_key, r.hash]),
);

function fields(c) {
  return {
    NOMCLI: clip([s(c.first_name), s(c.last_name)].filter(Boolean).join(' '), 40),
    NOMBRE: clip(s(c.first_name) || '', 50),
    APELLIDO: clip(s(c.last_name) || '', 50),
    CEDCLI: clip(s(c.document_number) || '', 10),
    TIPODOC: clip(s(c.document_type) || TIPODOC, 2),
    EMAIL: clip(s(c.email) || '', 50),
    TELCELU: clip(s(c.phone) || '', 12),
    SUCURSAL: clip(SUCURSAL, 3),
    ORIGENW: 'W',
    BLOQUE: 'F',
  };
}
const hashOf = (c) => sha1([c.first_name, c.last_name, c.document_number, c.document_type, c.phone, c.email].map((v) => s(v)));

let created = 0;
let updated = 0;
let untouched = 0;
for (const c of rows) {
  const hash = hashOf(c);
  const code = s(c.erp_customer_code);

  if (!code) {
    const payload = { CODCLI: newErpCode(c.id, 13), ...fields(c) };
    if (!APPLY) {
      log(`   [dry] crear ${c.id} → ${payload.CODCLI} ${payload.EMAIL}`);
      created++;
      continue;
    }
    const res = await erp.insert('poscli', payload);
    if (!res.ok) throw new Error(`insert POSCLI falló (${payload.CODCLI}): ${JSON.stringify(res)}`);
    await q('UPDATE customers SET erp_customer_code=$2, updated_at=now() WHERE id=$1', [c.id, payload.CODCLI]);
    await q(
      "INSERT INTO erp_snapshot (erp_table, erp_key, hash) VALUES ('PG_CUSTOMER',$1,$2) ON CONFLICT (erp_table, erp_key) DO UPDATE SET hash=EXCLUDED.hash, synced_at=now()",
      [String(c.id), hash],
    );
    log(`   ✅ creado ${c.id} → ${payload.CODCLI}`);
    created++;
    continue;
  }

  if (snap.get(String(c.id)) === hash) {
    untouched++;
    continue;
  }

  const f = fields(c);
  const setSql = Object.entries(f).map(([k, v]) => `${k}=${lit(v)}`).join(', ');
  if (!APPLY) {
    log(`   [dry] actualizar ${c.id} → ${code}`);
    updated++;
    continue;
  }
  await erp.sql(`UPDATE poscli SET ${setSql} WHERE CODCLI = ${lit(code)}`);
  await q(
    "INSERT INTO erp_snapshot (erp_table, erp_key, hash) VALUES ('PG_CUSTOMER',$1,$2) ON CONFLICT (erp_table, erp_key) DO UPDATE SET hash=EXCLUDED.hash, synced_at=now()",
    [String(c.id), hash],
  );
  log(`   ✅ actualizado ${c.id} → ${code}`);
  updated++;
}

log(`\n${APPLY ? '✅ Push clientes' : '🧪 DRY-RUN'} — creados: ${created}, actualizados: ${updated}, sin cambios: ${untouched}`);
await pg.end();
