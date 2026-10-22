/**
 * Escritura de catálogo/maestras Postgres → ERP (Advantage).
 *
 * Drena los eventos que el backend encoló en `erp_outbox` (triggers de las
 * migraciones 21, 22 y 25):
 *
 *   price        → TIDSAL.INVRVENTA1 / INVRVENTA0
 *   stock        → TIDSAL.INSALDO00 (por sucursal)
 *   brands       → TIDMARCAS (MCODIGO/MNOMBRE) + TIDSAL.INMARCAP
 *   categories   → TIDCATE   (CTABCOD/CTABDES; TIDSAL.INCATE apunta aquí)
 *   product_types→ TIDTPRO   (CODIGO/NOMBRE/HABILITA)
 *   products     → TIDSAL: INNOMBRE, INNOMBRE3/4 (atributos), INEAN,
 *                  INMARCAP, INTIPO, INCATE (atributo categoria-erp),
 *                  atributos enriquecidos y dimensiones
 *                  (por INARTIC = external_id)
 *   product_flags→ TIDSAL.INACTIVO (A/I; nunca pisa 'S' del ERP)
 *   order_status → DOMDIA.FAESTADO + DOMITE.IFESTADO (si se cancela)
 *
 * `INMARCA` no se escribe: en la copia no coincide con TIDMARCAS.MCODIGO
 * (ver docs/ESCRITURA-FORTUNER-READINESS.md).
 *
 * Códigos cerrados con FORTUNER: FAESTADO 0/5/9, IFESTADO vacío (normal,
 * 0x8000 en disco)/5 (cancelada), FATIPODOM '01', IFBODEGA '00', IFTIPO 'E'
 * (ver docs/ESCRITURA-FORTUNER-READINESS.md).
 *
 * El ERP sigue siendo el dueño del catálogo; esto es la vía "nuestro cambio
 * sube". Escritura gateada: por defecto **dry-run**; escribe sólo con `--apply`.
 *
 * Uso:
 *   node scripts-agent/erp/push-catalog.mjs                 # dry-run
 *   node scripts-agent/erp/push-catalog.mjs --apply --limit=200
 *   node scripts-agent/erp/push-catalog.mjs --kind=stock --limit=10
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log, clip, newErpCode, orderNumber } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LIMIT = a.limit ? Number(a.limit) : 200;
const KIND = a.kind ? String(a.kind) : null;

const erp = createErpClient();
const pg = createPg();
await pg.connect();
// Lo que subimos al ERP no debe reencolarse (evita ping-pong al escribir
// de vuelta códigos generados).
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const num = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`valor numérico inválido: ${v}`);
  return x;
};
const safeCode = (v) => {
  if (v === null || v === undefined) return null;
  const code = String(v).trim();
  return /^[A-Za-z0-9._-]{1,20}$/.test(code) ? code : null;
};
const tf = (b) => (b ? 'TRUE' : 'FALSE');

const productCache = new Map();

/**
 * Estado actual del producto en Postgres (fuente de verdad de lo que se edita
 * en el admin). Se lee por id porque los eventos de la migración 25 sólo traen
 * `{id, source}`; así el UPDATE al ERP siempre lleva la fila completa.
 */
async function productData(id) {
  if (!productCache.has(id)) {
    const r = await q(
      `SELECT p.id, p.external_id, p.name, p.is_active, p.description,
              b.name AS brand_name,
              pt.code AS type_code,
              v.barcode, v.length_mm, v.width_mm, v.height_mm,
              v.is_active AS variant_active,
              COALESCE(at.attrs, '{}'::jsonb) AS attrs
         FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN LATERAL (
           SELECT t.code
             FROM product_type_assignments a
             JOIN product_types t ON t.id = a.product_type_id
            WHERE a.product_id = p.id
            ORDER BY t.code
            LIMIT 1
         ) pt ON TRUE
         LEFT JOIN LATERAL (
           SELECT jsonb_object_agg(a.slug, COALESCE(pa.custom_value, ao.value)) AS attrs
             FROM product_attributes pa
             JOIN attributes a ON a.id = pa.attribute_id
             LEFT JOIN attribute_options ao ON ao.id = pa.attribute_option_id
            WHERE pa.product_id = p.id
         ) at ON TRUE
         LEFT JOIN LATERAL (
           SELECT v.barcode, v.length_mm, v.width_mm, v.height_mm, v.is_active
             FROM product_variants v
            WHERE v.product_id = p.id
            ORDER BY v.id
            LIMIT 1
         ) v ON TRUE
        WHERE p.id = $1`,
      [id],
    );
    productCache.set(id, r.rows[0] ?? null);
  }
  return productCache.get(id);
}

/** id del producto a partir del payload (fila completa o {id,source}). */
async function productIdOf(p) {
  if (p.id != null && Number.isFinite(Number(p.id))) return Number(p.id);
  const ext = s(p.external_id);
  if (!ext) return null;
  const r = await q(
    'SELECT id FROM products WHERE external_id = $1 AND deleted_at IS NULL',
    [ext],
  );
  return r.rows[0]?.id ?? null;
}

async function markSkipped(ev, reason = null) {
  skipped++;
  if (APPLY) {
    await q(
      "UPDATE erp_outbox SET status='skipped', last_error=$2 WHERE id=$1",
      [ev.id, reason],
    );
  }
}

const erpArticleCache = new Map();
/** ¿El SKU existe en TIDSAL? (sólo se consulta al aplicar, no en dry-run). */
async function erpArticleExists(sku) {
  if (!erpArticleCache.has(sku)) {
    const res = await erp.sql(
      `SELECT INARTIC FROM tidsal WHERE INARTIC = ${lit(sku)}`,
      1,
    );
    erpArticleCache.set(sku, (res.rows?.length ?? 0) > 0);
  }
  return erpArticleCache.get(sku);
}

const branchById = new Map(
  (await q('SELECT id, code FROM branches')).rows.map((r) => {
    const raw = String(r.code).replace(/^0+/, '') || '0';
    return [Number(r.id), { raw, n: Number(raw) }];
  }),
);
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
    `SELECT id, kind, payload FROM erp_outbox
      WHERE status='pending' ${KIND ? 'AND kind=$2' : ''}
      ORDER BY id LIMIT $1`,
    KIND ? [LIMIT, KIND] : [LIMIT],
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
        plan.push(`UPDATE tidsal SET INVRVENTA1 = ${num(price)}${Number.isFinite(cmp) ? `, INVRVENTA0 = ${num(cmp)}` : ''} WHERE INARTIC = ${lit(sku)}`);
        break;
      }
      case 'stock': {
        const sku = safeCode(await skuOf(Number(p.variant_id)));
        const branch = branchById.get(Number(p.branch_id));
        const stock = Number(p.stock);
        if (!sku || !branch || !Number.isFinite(branch.n) || !Number.isFinite(stock)) {
          throw new Error(`stock inválido: ${JSON.stringify(p)}`);
        }
        plan.push(`UPDATE tidsal SET INSALDO00 = ${num(stock)} WHERE INARTIC = ${lit(sku)} AND INSUC = ${num(branch.n)}`);
        break;
      }
      case 'brands': {
        const code = safeCode(p.code);
        const name = clip(s(p.name), 80);
        const brandId = Number(p.id);
        if (!name || !Number.isFinite(brandId)) throw new Error('brand inválida');
        const finalCode = code || newErpCode(brandId, 8);
        if (code) plan.push(`UPDATE tidmarcas SET MNOMBRE = ${lit(name)} WHERE MCODIGO = ${lit(code)}`);
        else plan.push({ table: 'tidmarcas', values: { MCODIGO: finalCode, MNOMBRE: name }, back: `UPDATE brands SET code = %CODE% WHERE id = ${brandId}` });
        // INMARCAP está denormalizado en TIDSAL: si se renombra la marca hay
        // que refrescar sus artículos (en trozos, Advantage no acepta listas
        // enormes en un solo UPDATE). INMARCA no se toca: en TIDSAL no coincide
        // con TIDMARCAS.MCODIGO (ver docs/ESCRITURA-FORTUNER-READINESS.md).
        const skus = (await q(
          'SELECT external_id FROM products WHERE brand_id = $1 AND external_id IS NOT NULL',
          [brandId],
        )).rows.map((r) => s(r.external_id)).filter(Boolean);
        for (let i = 0; i < skus.length; i += 400) {
          const list = skus.slice(i, i + 400).map(lit).join(',');
          plan.push(`UPDATE tidsal SET INMARCAP = ${lit(clip(name, 20))} WHERE INARTIC IN (${list})`);
        }
        break;
      }
      case 'categories': {
        const code = safeCode(p.code);
        const name = clip(s(p.name), 100);
        if (!name) throw new Error('category sin nombre');
        if (code) plan.push({ sql: `UPDATE tidcate SET CTABDES = ${lit(name)} WHERE CTABCOD = ${lit(code)}` });
        // TIDCATE.CTABCOD es char(6) y TIDSAL.INCATE referencia este árbol.
        else plan.push({ table: 'tidcate', values: { CTABCOD: newErpCode(p.id, 6), CTABDES: name, HABILITA: true }, back: `UPDATE categories SET code = %CODE% WHERE id = ${Number(p.id)}` });
        break;
      }
      case 'product_types': {
        const code = safeCode(p.code);
        const name = clip(s(p.name), 30);
        if (!code || !name) throw new Error('product_type sin código/nombre');
        plan.push({ sql: `UPDATE tidtpro SET NOMBRE = ${lit(name)}, HABILITA = ${tf(p.is_active)} WHERE CODIGO = ${lit(code)}` });
        break;
      }
      case 'products': {
        const id = await productIdOf(p);
        if (!id) { await markSkipped(ev, 'producto no encontrado'); continue; }
        const pd = await productData(id);
        if (!pd) { await markSkipped(ev, 'producto borrado'); continue; }
        const sku = safeCode(pd.external_id);
        const name = s(pd.name);
        if (!sku) { await markSkipped(ev, 'producto sin external_id'); continue; }
        if (!name) throw new Error(`producto ${id} sin nombre`);
        if (APPLY && !(await erpArticleExists(sku))) {
          await markSkipped(ev, `artículo ${sku} no existe en TIDSAL`);
          continue;
        }
        const attrs = pd.attrs || {};

        const sets = [
          `INNOMBRE = ${lit(clip(name, 60))}`,
          `INNOMBRE3 = ${lit(clip(attrs['nombre-corto'] || name, 20))}`,
        ];
        // Nombre largo de facturación: se conserva como atributo propio
        // (`nombre-largo`) para no reutilizar la descripción de la tienda.
        if (attrs['nombre-largo']) {
          sets.push(`INNOMBRE4 = ${lit(clip(attrs['nombre-largo'], 100))}`);
        }
        // barcode: sólo se escribe si hay valor. Un NULL local puede significar
        // "EAN duplicado descartado en la importación" y no debe borrar el del ERP.
        if (pd.barcode) sets.push(`INEAN = ${lit(clip(pd.barcode, 13))}`);
        // INMARCA no se toca: en TIDSAL no coincide con TIDMARCAS.MCODIGO
        // (ver docs/ESCRITURA-FORTUNER-READINESS.md). El nombre sí es estable.
        if (pd.brand_name) sets.push(`INMARCAP = ${lit(clip(pd.brand_name, 20))}`);
        if (pd.type_code) sets.push(`INTIPO = ${lit(clip(pd.type_code, 3))}`);
        // INCATE es una clasificación propia del ERP; se conserva en el
        // atributo `categoria-erp` (no es la categoría web).
        if (attrs['categoria-erp']) {
          sets.push(`INCATE = ${lit(clip(attrs['categoria-erp'], 6))}`);
        }
        // Atributos enriquecidos importados del ERP.
        if (attrs['unidad-medida']) sets.push(`INUNIDAD = ${lit(clip(attrs['unidad-medida'], 2))}`);
        if (attrs['presentacion']) sets.push(`INPRESEN = ${lit(clip(attrs['presentacion'], 3))}`);
        if (attrs['unidades-empaque'] != null && attrs['unidades-empaque'] !== '') {
          const emp = Number(attrs['unidades-empaque']);
          if (Number.isFinite(emp)) sets.push(`INEMBALAJE = ${num(emp)}`);
        }
        if (attrs['referencia-fabricante']) sets.push(`INPARTE = ${lit(clip(attrs['referencia-fabricante'], 16))}`);
        if (attrs['registro-invima']) sets.push(`ININVIMA = ${lit(clip(attrs['registro-invima'], 20))}`);
        if (attrs['cum']) sets.push(`INCUM = ${lit(clip(attrs['cum'], 18))}`);
        if (attrs['ubicacion-bodega']) sets.push(`INUBIC = ${lit(clip(attrs['ubicacion-bodega'], 10))}`);
        if (attrs['ean-caja']) sets.push(`INEAN14 = ${lit(clip(attrs['ean-caja'], 14))}`);
        // Dimensiones: Postgres en mm, ERP en cm.
        if (pd.length_mm != null) sets.push(`INLARGO = ${num(Number(pd.length_mm) / 10)}`);
        if (pd.width_mm != null) sets.push(`INANCHO = ${num(Number(pd.width_mm) / 10)}`);
        if (pd.height_mm != null) sets.push(`INALTO = ${num(Number(pd.height_mm) / 10)}`);

        plan.push(`UPDATE tidsal SET ${sets.join(', ')} WHERE INARTIC = ${lit(sku)}`);
        break;
      }
      case 'product_flags': {
        const id = await productIdOf(p);
        if (!id) { await markSkipped(ev, 'producto no encontrado'); continue; }
        const pd = await productData(id);
        if (!pd) { await markSkipped(ev, 'producto borrado'); continue; }
        const sku = safeCode(pd.external_id);
        if (!sku) { await markSkipped(ev, 'producto sin external_id'); continue; }
        if (APPLY && !(await erpArticleExists(sku))) {
          await markSkipped(ev, `artículo ${sku} no existe en TIDSAL`);
          continue;
        }
        // La variante también puede desactivarse; el artículo del ERP es uno.
        const active = !!pd.is_active && pd.variant_active !== false;
        // 'S' lo gobierna el ERP (suspendido): no se pisa desde el ecommerce.
        plan.push(
          `UPDATE tidsal SET INACTIVO = '${active ? 'A' : 'I'}' WHERE INARTIC = ${lit(sku)} AND INACTIVO <> 'S'`,
        );
        break;
      }
      case 'order_status': {
        const inv = statusMap.get(s(p.status));
        const ref = s(p.reference_code);
        if (!inv || !ref) { await markSkipped(ev, 'estado sin mapeo o pedido sin referencia'); continue; }
        const state = num(inv);
        // El pedido pudo enviarse con otra numeración (p. ej. antes de fijar el
        // prefijo web). Se lee el FAPEDIDO real para enlazar las líneas.
        const found = APPLY
          ? await erp.sql(`SELECT FAPEDIDO FROM domdia WHERE FACONTROL = ${lit(ref)}`, 1)
          : null;
        const pedido = s(found?.rows?.[0]?.[0]) || orderNumber(p.id);
        if (APPLY && !s(found?.rows?.[0]?.[0])) {
          await markSkipped(ev, 'pedido no existe en DOMDIA (FACONTROL)');
          continue;
        }
        plan.push(`UPDATE domdia SET FAESTADO = ${state} WHERE FACONTROL = ${lit(ref)}`);
        if (state === 5) {
          plan.push(`UPDATE domite SET IFESTADO = 5 WHERE IFPEDIDO = ${lit(clip(pedido, 9))}`);
        }
        break;
      }
      default:
        await markSkipped(ev, `kind no soportado: ${ev.kind}`);
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
