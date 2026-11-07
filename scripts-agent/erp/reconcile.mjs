/**
 * Conciliación ERP → Postgres de la facturación de NUESTROS pedidos.
 *
 *   erp_invoices / erp_payments  →  invoices / payments / orders
 *
 * El ERP factura los pedidos que le inyectamos (DOMDIA). Cuando lo hace, la
 * factura trae `FADOMICIL` = nº de pedido. Aquí se busca ese vínculo y se
 * actualiza el pedido del ecommerce (factura + estado).
 *
 * OJO: NO vuelca la facturación completa del ERP (eso es `sync-invoices.mjs`,
 * opcional). Sólo toca facturas que casan con NUESTROS pedidos.
 *
 * Vínculos que se prueban (configurables):
 *   - orders.reference_code            (lo escribimos en DOMDIA.FACONTROL)
 *   - orders.erp_document_ref
 *   - FAPEDIDO web (9 dígitos: prefijo 9 + id) y paddings legados (9/12)
 *
 * Uso:
 *   node scripts-agent/erp/reconcile.mjs --dry-run
 *   node scripts-agent/erp/reconcile.mjs --apply
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log, orderNumber } from './lib.mjs';

const a = args();
const DRY = !a.apply; // por seguridad: por defecto dry-run
const ERP_TABLE = 'erp_invoices';

// Mapa estado-factura ERP → estado de pedido ecommerce (ajustar con el ERP).
// FADDIA.FAESTADO: 1 vigente, 2 anulada; FATIPO: FA/CO/RE/AN/IN.
const STATUS_BY_TIPO = { AN: 'cancelled', RE: 'refunded' };

const pg = createPg();
await pg.connect();
// Aplicamos estado del ERP a nuestros pedidos: no reencolar al ERP.
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

const orders = (await q('SELECT id, reference_code, erp_document_ref, status FROM orders')).rows;
const byKey = new Map();
for (const o of orders) {
  const keys = new Set();
  if (o.reference_code) keys.add(String(o.reference_code));
  if (o.erp_document_ref) keys.add(String(o.erp_document_ref));
  keys.add(String(o.id).padStart(9, '0'));
  keys.add(String(o.id).padStart(12, '0'));
  keys.add(orderNumber(o.id));
  for (const k of keys) byKey.set(k, o);
}
log(`Pedidos: ${orders.length} | claves de vínculo: ${byKey.size}`);

const keys = [...byKey.keys()];
const found = (
  await q(
    `SELECT * FROM ${ERP_TABLE}
      WHERE domicilio IS NOT NULL AND domicilio <> '' AND domicilio = ANY($1::text[])`,
    [keys],
  )
).rows;
log(`Facturas del ERP que casan con nuestros pedidos: ${found.length}`);

if (!found.length) {
  log('   (nada que conciliar — ningún pedido nuestro está facturado todavía)');
  await pg.end();
  process.exit(0);
}

let invoices = 0;
let updated = 0;
for (const inv of found) {
  const o = byKey.get(String(inv.domicilio));
  if (!o) continue;
  const status = STATUS_BY_TIPO[inv.tipo] || o.status;
  if (DRY) {
    log(`   [dry] pedido ${o.id} ← factura ${inv.factura} (${inv.tipo}) neto ${inv.vlr_neto}`);
    invoices++;
    continue;
  }
  await q(
    `INSERT INTO invoices (order_id, invoice_number, issued_at, cufe_code, status)
     VALUES ($1,$2, $3, $4, $5)
     ON CONFLICT (order_id) DO UPDATE
       SET invoice_number=EXCLUDED.invoice_number, issued_at=EXCLUDED.issued_at,
           cufe_code=EXCLUDED.cufe_code, status=EXCLUDED.status, updated_at=now()`,
    [o.id, inv.factura, ymd(inv.fecha), inv.cufe, 'issued'],
  );
  await q(
    `UPDATE orders SET erp_document_ref=$2, status=$3, updated_at=now() WHERE id=$1`,
    [o.id, inv.factura, status],
  );
  invoices++;
  updated++;
}

log(`\n${DRY ? '🧪 DRY-RUN' : '✅ Conciliación'} — facturas: ${invoices}, pedidos actualizados: ${updated}`);
await pg.end();

/** int YYYYMMDD → Date | null */
function ymd(v) {
  const x = s(v);
  if (!x || !/^\d{8}$/.test(x)) return null;
  return `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}T00:00:00-05:00`;
}
