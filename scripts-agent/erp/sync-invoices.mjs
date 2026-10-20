/**
 * Espejo de la FACTURACIÓN del ERP (Advantage) hacia Postgres.
 *
 *   FADDIA → erp_invoices · FAPAGO → erp_payments
 *
 * ⚠️ OPCIONAL (Fase A de docs/PLAN-SINCRONIZACION-ERP.md): el ecommerce NO
 * consume estas tablas; sólo se conserva por análisis. Requiere `--full`.
 *
 * El ERP es el dueño (sólo lectura). NO son las tablas `invoices`/`payments`
 * del pedido web (ésas las llena el backend y están atadas a `orders`).
 *
 * Enfoque: lectura en *streaming* por páginas y upsert por lotes. No se guarda
 * nada en memoria: la propia Postgres decide si hay cambios con
 * `WHERE <tabla>.row_hash IS DISTINCT FROM EXCLUDED.row_hash`, así re-ejecutar
 * es idempotente y no reescribe filas iguales.
 *
 * Mapeo: docs/PLAN-INTEGRACION-ERP.md §4.5.
 *
 * Uso (opt-in):
 *   node scripts-agent/erp/sync-invoices.mjs --full --dry-run
 *   node scripts-agent/erp/sync-invoices.mjs --full --limit=5000
 *   node scripts-agent/erp/sync-invoices.mjs --full
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, n, args, log, sha1 } from './lib.mjs';

const a = args();
const DRY = !!a['dry-run'];
const LIMIT = a.limit ? Number(a.limit) : Infinity;
const PAGE = Number(a.page || 2000);
const CHUNK = 1000;

// Fase A (poda): el espejo completo de facturación NO hace parte del set
// requerido. Sólo se ejecuta con --full.
if (!a.full) {
  log('ℹ️  sync-invoices está DESHABILITADO por defecto (Fase A: poda del alcance).');
  log('   El ecommerce no usa `erp_invoices`/`erp_payments`; sólo se requiere la');
  log('   conciliación de facturas de NUESTROS pedidos (Fase B).');
  log('   Para forzar el espejo completo añade --full.');
  process.exit(0);
}

const erp = createErpClient();
const pg = createPg();
await pg.connect();
const q = (t, p) => pg.query(t, p);

const num = (v) => n(v);
const nn = (v) => s(v) || null; // '' -> null

async function insertBatches(table, cols, rows, conflict) {
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
  }
}

async function syncMirror({ erpTable, sql, cols, accept, target, targetCols, mapRow }) {
  log(`\n▶ ${erpTable} → ${target}`);
  const conflict =
    `ON CONFLICT (erp_key) DO UPDATE SET row_hash=EXCLUDED.row_hash, ` +
    `${targetCols.map((c) => `${c}=EXCLUDED.${c}`).join(', ')}, synced_at=now() ` +
    `WHERE ${target}.row_hash IS DISTINCT FROM EXCLUDED.row_hash`;
  const allCols = ['erp_key', 'row_hash', ...targetCols];

  let read = 0;
  let sent = 0;
  let dup = 0;
  let offset = 0;
  let buffer = new Map();
  let pending = 0;
  const flush = async () => {
    if (!buffer.size) return;
    const rows = [...buffer.values()];
    await insertBatches(target, allCols, rows, conflict);
    sent += rows.length;
    buffer = new Map();
    pending = 0;
  };

  for (;;) {
    const res = await erp.sql(sql, { limit: PAGE, offset });
    const { cols: rcols, rows } = res;
    if (!rows.length) break;
    const ix = new Map(rcols.map((c, i) => [c, i]));
    for (const row of rows) {
      const rec = Object.fromEntries(cols.map((c) => [c, s(row[ix.get(c)])]));
      if (!accept(rec)) continue;
      const h = sha1(cols.map((c) => rec[c]));
      const key = h;
      read++;
      if (buffer.has(key)) dup++;
      buffer.set(key, [key, h, ...mapRow(rec)]);
      pending++;
      if (pending >= CHUNK) await flush();
      if (read >= LIMIT) break;
    }
    if (read >= LIMIT || rows.length < PAGE) break;
    offset += rows.length;
  }
  await flush();
  log(`   leídos: ${read} | enviados: ${sent} | clave repetida: ${dup}`);
  return { read, sent, dup };
}

// ─────────────────────────── FADDIA → erp_invoices ───────────────────────────

const INV_COLS = [
  'FASUCUR', 'FAANO', 'FAMES', 'FAFACTURA', 'FAPREFIJO', 'FATIPO', 'FAESTADO',
  'FAFCHFAC', 'FATIME', 'FAVLRBRU', 'FAVLRDES', 'FAVLRIVA', 'FAVLRNET',
  'FATOPAGO', 'FACODIGO', 'FANOMCOMP', 'FANIT', 'FATELEF', 'FAEMAIL',
  'FACIUDAD', 'FADIRECC', 'FADOMICIL', 'FADOMITIPO', 'FACUFE', 'FAFEID',
  'FAOBSER1', 'FAOBSER2', 'FAPAGO',
];
const INV_TARGET = [
  'sucursal', 'ano', 'mes', 'factura', 'prefijo', 'tipo', 'estado', 'fecha',
  'hora', 'vlr_bruto', 'vlr_descuento', 'vlr_iva', 'vlr_neto', 'total_pago',
  'codigo_cliente', 'nombre_cliente', 'nit', 'telefono', 'email', 'ciudad',
  'direccion', 'domicilio', 'domi_tipo', 'cufe', 'feid', 'obser1', 'obser2',
  'medio_pago',
];

const inv = DRY
  ? { read: 0, sent: 0 }
  : await syncMirror({
      erpTable: 'FADDIA',
      sql: `SELECT ${INV_COLS.join(', ')} FROM faddia`,
      cols: INV_COLS,
      accept: () => true,
      target: 'erp_invoices',
      targetCols: INV_TARGET,
      mapRow: (r) => [
        nn(r.FASUCUR), num(r.FAANO), num(r.FAMES), nn(r.FAFACTURA), nn(r.FAPREFIJO),
        nn(r.FATIPO), nn(r.FAESTADO), num(r.FAFCHFAC), nn(r.FATIME),
        num(r.FAVLRBRU), num(r.FAVLRDES), num(r.FAVLRIVA), num(r.FAVLRNET),
        num(r.FATOPAGO), nn(r.FACODIGO), nn(r.FANOMCOMP), nn(r.FANIT), nn(r.FATELEF),
        nn(r.FAEMAIL), nn(r.FACIUDAD), nn(r.FADIRECC), nn(r.FADOMICIL),
        nn(r.FADOMITIPO), nn(r.FACUFE), nn(r.FAFEID), nn(r.FAOBSER1), nn(r.FAOBSER2),
        nn(r.FAPAGO),
      ],
    });

// ─────────────────────────── FAPAGO → erp_payments ───────────────────────────

const PAY_COLS = [
  'FPSUCUR', 'FPANO', 'FPMES', 'FPCAJA', 'FPFEC', 'FPFACT', 'FPCODI',
  'FPVALOR', 'FPIVA', 'FPNUMERO', 'FPTIPO', 'FPCLIENTE', 'FPAUTO',
];
const PAY_TARGET = [
  'sucursal', 'ano', 'mes', 'caja', 'fecha', 'factura', 'codigo', 'valor',
  'iva', 'numero', 'tipo', 'cliente', 'auto',
];

const pay = DRY
  ? { read: 0, sent: 0 }
  : await syncMirror({
      erpTable: 'FAPAGO',
      sql: `SELECT ${PAY_COLS.join(', ')} FROM fapago`,
      cols: PAY_COLS,
      accept: () => true,
      target: 'erp_payments',
      targetCols: PAY_TARGET,
      mapRow: (r) => [
        nn(r.FPSUCUR), num(r.FPANO), num(r.FPMES), nn(r.FPCAJA), num(r.FPFEC),
        nn(r.FPFACT), nn(r.FPCODI), num(r.FPVALOR), num(r.FPIVA), nn(r.FPNUMERO),
        nn(r.FPTIPO), nn(r.FPCLIENTE), nn(r.FPAUTO),
      ],
    });

// ─────────────────────────── resumen ───────────────────────────

if (DRY) {
  log('\n🧪 DRY-RUN — nada escrito.');
} else {
  const counts = (
    await q(`SELECT (SELECT count(*)::int FROM erp_invoices) erp_invoices,
                    (SELECT count(*)::int FROM erp_payments) erp_payments`)
  ).rows[0];
  log('\n✅ Sync facturación terminado');
  log(counts);
  log(`   FADDIA: leídos ${inv.read} / enviados ${inv.sent} | FAPAGO: leídos ${pay.read} / enviados ${pay.sent}`);
}
await pg.end();
