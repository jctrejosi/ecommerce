/**
 * Escritura de catálogo/maestras Postgres → ERP (Advantage).
 *
 * Drena los eventos que el backend encoló en `erp_outbox` (triggers de las
 * migraciones 21 y 22):
 *
 *   price        → TIDSAL.INVRVENTA1 / INVRVENTA0
 *   stock        → TIDSAL.INSALDO00 (por sucursal)
 *   brands       → TIDMARCAS (MCODIGO/MNOMBRE)
 *   categories   → TIDTAB    (CTABCOD/CTABDES)
 *   product_types→ TIDTPRO   (CODIGO/NOMBRE/HABILITA)
 *   products     → TIDSAL.INNOMBRE (por INARTIC = external_id)
 *   order_status → DOMDIA.FAESTADO (mapa `erp_code_map` dominio 'order_status')
 *
 * El ERP sigue siendo el dueño del catálogo; esto es la vía "nuestro cambio
 * sube". Escritura gateada: por defecto **dry-run**; escribe sólo con `--apply`.
 *
 * Uso:
 *   node scripts-agent/erp/push-catalog.mjs                 # dry-run
 *   node scripts-agent/erp/push-catalog.mjs --apply --limit=200
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LIMIT = a.limit ? Number(a.limit) : 200;
const PREFIX = process.env.ERP_NEW_CODE_PREFIX || 'DSI';

const erp = createErpClient();
const pg = createPg();
await pg.connect();
// Lo que subimos al ERP no debe reencolarse (evita ping-pong al escribir
// de vuelta códigos generados).
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const safeCode = (v) => (/^[A-Za-z0-9._-]{1,20}$/.test(String(v)) ? String(v) : null);
const newCode = (id) => PREFIX + String(id).padStart(8, '0');
const tf = (b) => (b ? 'T' : 'F');

const branchById = new Map((await q('SELECT id, code FROM branches')).rows.map((r) => [Number(r.id), String(r.code).replace(/^0+/, '') || '0']));
const skuCache = new Map();
async function skuOf(vid) {
  if (!skuCache.has(vid)) {
    const r = await q('SELECT sku FROM product_variants WHERE id=$1', [vid]);
    skuCache.set(vid, r.rows[0]?.sku ?? null);
  }
  return skuCache.get(vid);
}
// Mapa estado-pedido (ecommerce → FAESTADO). Se puebla en erp_code_map.
const statusMap = new Map(
  (await q("SELECT erp_value, canonical FROM erp_code_map WHERE domain='order_status'")).rows.map((r) => [r.canonical, r.erp_value]),
);

const pending = (
  await q(
    `SELECT id, kind, payload FROM erp_outbox WHERE status='pending' ORDER BY id LIMIT $1`,
    [LIMIT],
  )
).rows;
log(`Eventos pendientes: ${pending.length}${APPLY ? '' : ' (dry-run)'}${statusMap.size ? '' : ' · sin mapa de estados'}`);

let applied = 0;
let skipped = 0;
let failed = 0;
for (const ev of pending) {
  const p = ev.payload || {};
  try {
    const plan = [];
    switch (ev.kind) {
      case 'price': {
        const sku = safeCode(p.sku);
        const price = Number(p.price);
        if (!sku || !Number.isFinite(price)) throw new Error(`price inválido: ${JSON.stringify(p)}`);
        const cmp = p.compare_price == null ? null : Number(p.compare_price);
        plan.push(`UPDATE tidsal SET INVRVENTA1 = ${price}${Number.isFinite(cmp) ? `, INVRVENTA0 = ${cmp}` : ''} WHERE INARTIC = ${lit(sku)}`);
        break;
      }
      case 'stock': {
        const sku = safeCode(await skuOf(Number(p.variant_id)));
        const code = branchById.get(Number(p.branch_id));
        const stock = Number(p.stock);
        if (!sku || !code || !Number.isFinite(stock)) throw new Error(`stock inválido: ${JSON.stringify(p)}`);
        plan.push(`UPDATE tidsal SET INSALDO00 = ${stock} WHERE INARTIC = ${lit(sku)} AND INSUC = ${lit(code)}`);
        break;
      }
      case 'brands': {
        const code = safeCode(p.code);
        const name = s(p.name);
        if (!name) throw new Error('brand sin nombre');
        if (code) plan.push({ sql: `UPDATE tidmarcas SET MNOMBRE = ${lit(name)} WHERE MCODIGO = ${lit(code)}` });
        else plan.push({ table: 'tidmarcas', values: { MCODIGO: newCode(p.id), MNOMBRE: name }, back: `UPDATE brands SET code = %CODE% WHERE id = ${Number(p.id)}` });
        break;
      }
      case 'categories': {
        const code = safeCode(p.code);
        const name = s(p.name);
        if (!name) throw new Error('category sin nombre');
        if (code) plan.push({ sql: `UPDATE tidtab SET CTABDES = ${lit(name)} WHERE CTABCOD = ${lit(code)}` });
        else plan.push({ table: 'tidtab', values: { CTABCOD: newCode(p.id), CTABDES: name }, back: `UPDATE categories SET code = %CODE% WHERE id = ${Number(p.id)}` });
        break;
      }
      case 'product_types': {
        const code = safeCode(p.code);
        const name = s(p.name);
        if (!code || !name) throw new Error('product_type sin código/nombre');
        plan.push({ sql: `UPDATE tidtpro SET NOMBRE = ${lit(name)}, HABILITA = ${lit(tf(p.is_active))} WHERE CODIGO = ${lit(code)}` });
        break;
      }
      case 'products': {
        const sku = safeCode(p.external_id);
        const name = s(p.name);
        if (!sku) { skipped++; await q("UPDATE erp_outbox SET status='skipped' WHERE id=$1", [ev.id]); continue; }
        if (!name) throw new Error('product sin nombre');
        plan.push(`UPDATE tidsal SET INNOMBRE = ${lit(name.slice(0, 60))} WHERE INARTIC = ${lit(sku)}`);
        break;
      }
      case 'order_status': {
        const inv = statusMap.get(s(p.status));
        const ref = s(p.reference_code);
        if (!inv || !ref) { skipped++; await q("UPDATE erp_outbox SET status='skipped' WHERE id=$1", [ev.id]); continue; }
        plan.push(`UPDATE domdia SET FAESTADO = ${lit(inv)} WHERE FACONTROL = ${lit(ref)}`);
        break;
      }
      default:
        skipped++;
        await q("UPDATE erp_outbox SET status='skipped' WHERE id=$1", [ev.id]);
        continue;
    }

    if (!APPLY) {
      log(`   [dry] ${ev.kind}: ${JSON.stringify(plan)}`);
      applied++;
      continue;
    }
    for (const step of plan) {
      if (typeof step === 'string') {
        await erp.sql(step);
      } else if (step.sql) {
        await erp.sql(step.sql);
      } else {
        const res = await erp.insert(step.table, step.values);
        if (!res.ok) throw new Error(`insert ${step.table} falló: ${JSON.stringify(res)}`);
        await q(step.back.replace('%CODE%', lit(step.values[Object.keys(step.values)[0]])));
      }
    }
    await q("UPDATE erp_outbox SET status='sent', sent_at=now(), acked_at=now() WHERE id=$1", [ev.id]);
    applied++;
  } catch (e) {
    failed++;
    log(`   ❌ evento ${ev.id} (${ev.kind}): ${e.message}`);
    if (APPLY) await q("UPDATE erp_outbox SET status='error', attempts=attempts+1, last_error=$2 WHERE id=$1", [ev.id, String(e.message).slice(0, 500)]);
  }
}

log(`\n${APPLY ? '✅ Push catálogo' : '🧪 DRY-RUN'} — aplicados: ${applied}, omitidos: ${skipped}, fallidos: ${failed}`);
await pg.end();
