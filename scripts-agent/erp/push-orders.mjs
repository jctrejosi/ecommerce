/**
 * Fase 4 — salida Postgres → ERP (Advantage/OpenADS).
 *
 * Toma pedidos del ecommerce y los escribe en el ERP como DOMDIA (cabecera)
 * + DOMITE (ítems), para que el ERP los pueda facturar.
 *
 * Mapeo de campos: docs/PLAN-INTEGRACION-ERP.md §4.4.
 *
 * Idempotencia: `FACONTROL` = `orders.reference_code`. Antes de insertar se
 * comprueba (local y contra el ERP) que ese control no exista ya; al terminar se
 * marca `orders.erp_sync_status` y se deja rastro en `erp_outbox`.
 *
 * ⚠️  Piloto contra la copia. Valores aún NO confirmados por el ERP (se pueden
 *     ajustar por env): FAPEDIDO (numeración), FAESTADO/IFESTADO, FATIPODOM.
 *
 * Uso:
 *   node scripts-agent/erp/push-orders.mjs --dry-run
 *   node scripts-agent/erp/push-orders.mjs --limit=3
 *   node scripts-agent/erp/push-orders.mjs --order=508
 *   node scripts-agent/erp/push-orders.mjs            # todos los pendientes
 *   node scripts-agent/erp/push-orders.mjs --force    # re-envía aunque estén marcados
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log } from './lib.mjs';

const a = args();
const DRY = !!a['dry-run'];
const FORCE = !!a.force;
const LIMIT = a.limit ? Number(a.limit) : 50;
const ONLY_ORDER = a.order ? Number(a.order) : null;

// Valores de estado/numeración propios del piloto (pendientes de confirmar).
const FAESTADO = Number(process.env.ERP_FAESTADO ?? 0);
const IFESTADO = Number(process.env.ERP_IFESTADO ?? 0);
const FATIPODOM = process.env.ERP_TIPODOM ?? '01';
const IFTIPO = process.env.ERP_IFTIPO ?? 'E'; // E = venta

// Ecommerce payment_method → POSPAGO.CODIGO (propuesta §4.6, a confirmar).
const PAY_MAP = { CASH: 'EF', CARD: 'TC', PSE: 'TF', NEQUI: 'TF', DAVIPLATA: 'TF' };

const money = (v) => Number(v || 0).toFixed(2);
const pad2 = (v) => String(v).replace(/^0+/, '').padStart(2, '0');
const clip = (v, n) => (v == null ? '' : String(v)).slice(0, n);

/** Fecha/hora del pedido en zona Colombia → { ymd: "YYYYMMDD", hms: "HH:MM:SS" }. */
function bogota(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { ymd: `${p.year}${p.month}${p.day}`, hms: `${p.hour}:${p.minute}:${p.second}` };
}

const erp = createErpClient();
const pg = createPg();
await pg.connect();
const q = (t, p) => pg.query(t, p);

// ─────────────────────── selects ───────────────────────

const ORDER_COLS = `
  o.id, o.reference_code, o.status, o.branch_id, b.code AS branch_code,
  o.subtotal, o.discount_total, o.tax_total, o.shipping_cost, o.shipping_tax, o.grand_total,
  o.customer_name, o.customer_phone, o.customer_email, o.notes, o.created_at,
  o.customer_id, o.customer_address_id, o.erp_document_ref, o.erp_sync_status,
  c.erp_customer_code, c.document_number, c.first_name, c.last_name, c.phone AS c_phone,
  ca.address_line1, ca.address_line2, ca.city`;

const ordersSql = `
  SELECT ${ORDER_COLS}
  FROM orders o
  JOIN branches b ON b.id = o.branch_id
  LEFT JOIN customers c ON c.id = o.customer_id
  LEFT JOIN customer_addresses ca ON ca.id = o.customer_address_id
  WHERE o.status NOT IN ('cancelled', 'refunded')
    ${FORCE ? '' : 'AND o.erp_sync_status IS NULL'}
    ${ONLY_ORDER ? 'AND o.id = $1' : ''}
  ORDER BY o.id
  LIMIT ${ONLY_ORDER ? 1 : LIMIT}`;

const orders = (await q(ordersSql, ONLY_ORDER ? [ONLY_ORDER] : [])).rows;
log(`Pedidos a procesar: ${orders.length}`);
if (!orders.length) {
  log('✅ Nada pendiente.');
  await pg.end();
  process.exit(0);
}

// ─────────────────── FACONTROL ya presentes en el ERP ───────────────────

log('⏳ Cargando FACONTROL existentes en el ERP…');
const existingControl = new Set();
{
  let offset = 0;
  const PAGE = 5000;
  for (;;) {
    const res = await erp.sql('SELECT FACONTROL FROM domdia', { limit: PAGE, offset });
    for (const r of res.rows) {
      const v = s(r[0]);
      if (v) existingControl.add(v);
    }
    if (res.rows.length < PAGE) break;
    offset += res.rows.length;
  }
}
log(`   ${existingControl.size} controles existentes`);

// ─────────────────── helpers de escritura ───────────────────

async function insertOrder(ord) {
  const items = (
    await q(
      `SELECT oi.*, pv.sku AS pv_sku, pv.barcode AS pv_barcode
         FROM order_items oi
         LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
        WHERE oi.order_id = $1 ORDER BY oi.id`,
      [ord.id],
    )
  ).rows;
  const pays = (await q('SELECT payment_method, amount FROM payments WHERE order_id = $1 ORDER BY id LIMIT 3', [ord.id])).rows;

  const { ymd, hms } = bogota(ord.created_at);
  const sucursal = pad2(ord.branch_code);
  const pedido = String(ord.id).padStart(9, '0'); // numeración propia del piloto
  const control = clip(ord.reference_code, 36);

  const codcli = clip(ord.erp_customer_code || ord.document_number || '', 13);
  const nombre = clip(ord.customer_name || [ord.first_name, ord.last_name].filter(Boolean).join(' ') || 'CLIENTE WEB', 45);
  const direc = clip([ord.address_line1, ord.address_line2].filter(Boolean).join(' '), 60);
  const telefono = clip(ord.customer_phone || ord.c_phone, 15);
  const celular = clip(ord.c_phone || ord.customer_phone, 15);
  const nit = clip(ord.document_number, 15);
  const email = clip(ord.customer_email, 50);

  // Ítems (con las invariantes de §4.4)
  const domiteRows = [];
  let sumBase = 0, sumIva = 0, sumNet = 0;
  for (const it of items) {
    const qty = Number(it.quantity);
    const uniGross = Number(it.unit_price_gross);
    const rate = Number(it.tax_rate || 0);
    const vlrnet = qty * uniGross;
    const vlrbru = rate > 0 ? vlrnet / (1 + rate / 100) : vlrnet;
    const vlriva = vlrnet - vlrbru;
    sumBase += vlrbru; sumIva += vlriva; sumNet += vlrnet;

    domiteRows.push({
      IFFACT: '',
      IFPEDIDO: pedido,
      IFCLIENTE: codcli,
      IFARTIC: clip(it.variant_sku || it.pv_sku, 19), // SKU: la relación manda sobre la copia de la línea
      IFEAN: clip(it.pv_barcode, 18),
      IFNOMBRE: clip(it.product_name, 60),
      IFCANT: money(qty),
      IFVLRUNI: money(uniGross),
      IFVLRBRU: money(vlrbru),
      IFPORIVA: money(rate),
      IFVLRIVA: money(vlriva),
      IFVLRNET: money(vlrnet),
      IFPORDES: money(0),
      IFVLRDES: money(it.discount_amount || 0),
      IFESTADO: String(IFESTADO),
      IFFECHA: ymd,
      IFTIPO,
      IFSUCUR: sucursal,
      IFBODEGA: '00',
    });
  }

  // Sanidad: la base neta de las líneas debe cuadrar con el subtotal del pedido.
  if (Math.abs(sumBase - Number(ord.subtotal || 0)) > 1) {
    log(`   ⚠️  pedido ${ord.id}: base de líneas ${money(sumBase)} ≠ subtotal ${money(ord.subtotal)}`);
  }

  // Cabecera: totales del pedido (§4.4). El domicilio no va en las líneas, así
  // que FAVLRNET = grand_total y el envío se registra en FAVARIOS para cuadrar
  // con lo pagado. Las líneas cumplen sus propias invariantes.
  const header = {
    FASUCUR: sucursal,
    FAFACTURA: '',
    FAPEDIDO: clip(pedido, 12),
    FACODIGO: codcli,
    FANOMBRE: nombre,
    FADIREC: direc,
    FACIUDAD: clip(ord.city, 12),
    FATELEF: telefono,
    FACELU: celular,
    FANIT: nit,
    FAEMAIL: email,
    FAFCHFAC: ymd,
    FATIME: hms,
    FAVLRBRU: money(ord.subtotal),
    FAVLRDES: money(ord.discount_total),
    FAVLRIVA: money(ord.tax_total),
    FAVARIOS: money(Number(ord.shipping_cost || 0) + Number(ord.shipping_tax || 0)),
    FAVLRNET: money(ord.grand_total),
    FAPAG01: PAY_MAP[pays[0]?.payment_method] ?? '',
    FAVLR01: money(pays[0]?.amount),
    FAPAG02: PAY_MAP[pays[1]?.payment_method] ?? '',
    FAVLR02: money(pays[1]?.amount),
    FAPAG03: PAY_MAP[pays[2]?.payment_method] ?? '',
    FAVLR03: money(pays[2]?.amount),
    FATIPODOM,
    FAESTADO: String(FAESTADO),
    FAOBSER: clip(ord.notes, 250),
    FACONTROL: control,
  };

  if (DRY) {
    log(`   [dry] pedido ${ord.id} ${ord.reference_code} → DOMDIA suc=${sucursal} net=${money(ord.grand_total)} + ${domiteRows.length} ítems`);
    return { ok: true, dry: true };
  }

  // Cabecera
  const hres = await erp.insert('domdia', clean(header));
  if (!hres.ok) throw new Error(`DOMDIA insert falló: ${JSON.stringify(hres)}`);

  // Ítems
  for (const row of domiteRows) {
    const ires = await erp.insert('domite', clean(row));
    if (!ires.ok) throw new Error(`DOMITE insert falló (artic ${row.IFARTIC}): ${JSON.stringify(ires)}`);
  }

  return { ok: true, recno: hres.recno, control: header.FACONTROL, pedido: header.FAPEDIDO, sumNet: money(ord.grand_total), items: domiteRows.length };
}

/** Quita claves con valor vacío (el endpoint solo escribe lo que recibe). */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v == null) continue;
    out[k] = v;
  }
  return out;
}

// ─────────────────── ejecución ───────────────────

// Bitácora de la corrida
let runId = null;
if (!DRY) {
  runId = (await q("INSERT INTO erp_sync_runs (kind, direction, read_count) VALUES ('order','out',$1) RETURNING id", [orders.length])).rows[0].id;
}

let applied = 0, skipped = 0, failed = 0;
for (const ord of orders) {
  const control = clip(ord.reference_code, 36);
  if (existingControl.has(control)) {
    if (!FORCE) {
      log(`   ⏭  pedido ${ord.id} ${ord.reference_code}: ya en el ERP (FACONTROL)`);
      if (!DRY)
        await q("UPDATE orders SET erp_sync_status='sent', erp_document_ref=COALESCE(erp_document_ref,$2) WHERE id=$1", [ord.id, control]);
      skipped++;
      continue;
    }
  }
  try {
    const res = await insertOrder(ord);
    if (DRY) { applied++; continue; }
    await q("UPDATE orders SET erp_sync_status='sent', erp_document_ref=$2, updated_at=now() WHERE id=$1", [ord.id, res.control]);
    await q(
      `INSERT INTO erp_outbox (kind, idempotency_key, payload, status, erp_ref, sent_at, acked_at)
       VALUES ('order',$1,$2,'sent',$3,now(),now())
       ON CONFLICT (idempotency_key) DO UPDATE
         SET status='sent', erp_ref=EXCLUDED.erp_ref, sent_at=now(), acked_at=now(), last_error=NULL`,
      [res.control, JSON.stringify({ order_id: ord.id, pedido: res.pedido, items: res.items }), res.pedido],
    );
    existingControl.add(res.control);
    log(`   ✅ pedido ${ord.id} ${ord.reference_code} → ${res.pedido} (${res.items} ítems, net ${res.sumNet})`);
    applied++;
  } catch (e) {
    failed++;
    log(`   ❌ pedido ${ord.id} ${ord.reference_code}: ${e.message}`);
    if (!DRY) {
      await q("UPDATE orders SET erp_sync_status='error' WHERE id=$1", [ord.id]);
      await q(
        `INSERT INTO erp_outbox (kind, idempotency_key, payload, status, attempts, last_error)
         VALUES ('order',$1,$2,'error',1,$3)
         ON CONFLICT (idempotency_key) DO UPDATE SET status='error', attempts=erp_outbox.attempts+1, last_error=EXCLUDED.last_error`,
        [control, JSON.stringify({ order_id: ord.id }), String(e.message).slice(0, 500)],
      );
    }
  }
}

if (!DRY && runId) {
  await q('UPDATE erp_sync_runs SET finished_at=now(), applied=$2, failed=$3 WHERE id=$1', [runId, applied, failed]);
}

log(`\n${DRY ? '🧪 DRY-RUN' : '✅ Push terminado'} — aplicados: ${applied}, ya existían: ${skipped}, fallidos: ${failed}`);
await pg.end();
