/**
 * Escritura de catálogo Postgres → ERP (Advantage `TIDSAL`).
 *
 * Drena los eventos que el backend encoló en `erp_outbox` (los pusieron los
 * triggers de la migración 21 al tocar `product_variants`/`inventory`):
 *
 *   erp_outbox(kind='price')  →  TIDSAL.INVRVENTA1 / INVRVENTA0
 *   erp_outbox(kind='stock')  →  TIDSAL.INSALDO00 (por sucursal)
 *
 * El ERP sigue siendo el dueño del catálogo; esto es la vía "nuestro cambio
 * sube". Escritura gateada: por defecto **dry-run**; escribe sólo con `--apply`.
 *
 * Notas:
 *   - El precio (lista 1) se asume global → se escribe en todas las sucursales
 *     del artículo. Si el ERP maneja listas por sucursal, ajustar aquí.
 *   - El stock se escribe por la sucursal del evento. Ojo: mejor por
 *     MOVIMIENTOS; aquí se pisa `INSALDO00` (provisional).
 *
 * Uso:
 *   node scripts-agent/erp/push-catalog.mjs                 # dry-run
 *   node scripts-agent/erp/push-catalog.mjs --apply --limit=50
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LIMIT = a.limit ? Number(a.limit) : 200;

const erp = createErpClient();
const pg = createPg();
await pg.connect();
const q = (t, p) => pg.query(t, p);

/** Literal SQL seguro (string entre comillas simples). */
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const safeSku = (v) => (/^[A-Za-z0-9._-]{1,19}$/.test(String(v)) ? String(v) : null);
const brCode = (c) => String(c).replace(/^0+/, '') || '0';

const pending = (
  await q(
    `SELECT id, kind, payload FROM erp_outbox
      WHERE kind IN ('price','stock') AND status = 'pending'
      ORDER BY id LIMIT $1`,
    [LIMIT],
  )
).rows;
log(`Eventos de catálogo pendientes: ${pending.length}${APPLY ? '' : ' (dry-run)'}`);

const branchById = new Map((await q('SELECT id, code FROM branches')).rows.map((r) => [Number(r.id), brCode(r.code)]));
const skuCache = new Map();
async function skuOf(vid) {
  if (!skuCache.has(vid)) {
    const r = await q('SELECT sku FROM product_variants WHERE id=$1', [vid]);
    skuCache.set(vid, r.rows[0]?.sku ?? null);
  }
  return skuCache.get(vid);
}

let applied = 0;
let failed = 0;
for (const ev of pending) {
  try {
    let sql = null;
    if (ev.kind === 'price') {
      const sku = safeSku(ev.payload.sku);
      const price = Number(ev.payload.price);
      if (!sku || !Number.isFinite(price)) throw new Error(`evento price inválido: ${JSON.stringify(ev.payload)}`);
      const cmp = ev.payload.compare_price == null ? null : Number(ev.payload.compare_price);
      sql =
        `UPDATE tidsal SET INVRVENTA1 = ${price}` +
        (cmp != null && Number.isFinite(cmp) ? `, INVRVENTA0 = ${cmp}` : '') +
        ` WHERE INARTIC = ${lit(sku)}`;
    } else if (ev.kind === 'stock') {
      const sku = safeSku(await skuOf(Number(ev.payload.variant_id)));
      const code = branchById.get(Number(ev.payload.branch_id));
      const stock = Number(ev.payload.stock);
      if (!sku || !code || !Number.isFinite(stock)) throw new Error(`evento stock inválido: ${JSON.stringify(ev.payload)}`);
      sql = `UPDATE tidsal SET INSALDO00 = ${stock} WHERE INARTIC = ${lit(sku)} AND INSUC = ${lit(code)}`;
    }
    if (!sql) continue;

    if (!APPLY) {
      log(`   [dry] ${ev.kind}: ${sql}`);
      applied++;
      continue;
    }
    await erp.sql(sql);
    await q("UPDATE erp_outbox SET status='sent', sent_at=now(), acked_at=now() WHERE id=$1", [ev.id]);
    applied++;
  } catch (e) {
    failed++;
    log(`   ❌ evento ${ev.id} (${ev.kind}): ${e.message}`);
    if (APPLY) await q("UPDATE erp_outbox SET status='error', attempts=attempts+1, last_error=$2 WHERE id=$1", [ev.id, String(e.message).slice(0, 500)]);
  }
}

log(`\n${APPLY ? '✅ Push catálogo' : '🧪 DRY-RUN'} — aplicados: ${applied}, fallidos: ${failed}`);
await pg.end();
