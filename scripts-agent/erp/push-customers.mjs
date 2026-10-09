/**
 * Alta de clientes del ecommerce → ERP (Advantage `POSCLI`).
 *
 *   customers (Postgres)  →  POSCLI (ERP)
 *
 * Se ejecuta cuando un cliente se crea en el ecommerce y hay que reflejarlo en
 * el ERP para poder facturarle. El ERP es el dueño del `CODCLI`; mientras se
 * confirma su algoritmo (§11 del plan) se genera con `ERP_CODCLI_SEQ`
 * (formato `2999########`, 13 dígitos) y se guarda de vuelta en
 * `customers.erp_customer_code`.
 *
 * Alcance: clientes locales (`provider='local'`, sin `erp_customer_code`).
 * Escritura gateada: por defecto **dry-run**; escribe sólo con `--apply`.
 *
 * Uso:
 *   node scripts-agent/erp/push-customers.mjs                 # dry-run
 *   node scripts-agent/erp/push-customers.mjs --apply --limit=1
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LIMIT = a.limit ? Number(a.limit) : 50;
const SEQ0 = Number(process.env.ERP_CODCLI_SEQ || 1);
const SUCURSAL = process.env.ERP_CUSTOMER_SUCURSAL || '01';
const TIPODOC = process.env.ERP_CUSTOMER_TIPODOC || '13';

const codcli = (i) => '2999' + String(SEQ0 + i).padStart(9, '0');

const erp = createErpClient();
const pg = createPg();
await pg.connect();

const rows = (
  await pg.query(
    `SELECT id, first_name, last_name, document_number, document_type, phone, email
       FROM customers
      WHERE deleted_at IS NULL AND erp_customer_code IS NULL AND provider = 'local'
      ORDER BY id
      LIMIT $1`,
    [LIMIT],
  )
).rows;
log(`Clientes locales sin código ERP: ${rows.length}${APPLY ? '' : ' (dry-run)'}`);

let ok = 0;
for (let i = 0; i < rows.length; i++) {
  const c = rows[i];
  const code = codcli(i);
  const payload = {
    CODCLI: code,
    NOMCLI: [s(c.first_name), s(c.last_name)].filter(Boolean).join(' ').slice(0, 40),
    NOMBRE: s(c.first_name) || '',
    APELLIDO: s(c.last_name) || '',
    CEDCLI: s(c.document_number) || '',
    TIPODOC: s(c.document_type) || TIPODOC,
    EMAIL: s(c.email) || '',
    TELCELU: s(c.phone) || '',
    SUCURSAL,
    ORIGENW: 'W',
    BLOQUE: 'F',
  };
  if (!APPLY) {
    log(`   [dry] ${c.id} ${payload.EMAIL} → POSCLI.CODCLI=${code}`);
    ok++;
    continue;
  }
  const res = await erp.insert('poscli', payload);
  if (!res.ok) throw new Error(`insert POSCLI falló (${code}): ${JSON.stringify(res)}`);
  await pg.query('UPDATE customers SET erp_customer_code=$2, updated_at=now() WHERE id=$1', [c.id, code]);
  log(`   ✅ ${c.id} → CODCLI ${code} (recno ${res.recno})`);
  ok++;
}

log(`\n${APPLY ? '✅ Push clientes' : '🧪 DRY-RUN'} — ${ok}/${rows.length}`);
await pg.end();
