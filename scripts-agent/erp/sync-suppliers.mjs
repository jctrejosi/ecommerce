/**
 * Sincroniza el maestro de PROVEEDORES del ERP (Advantage) hacia Postgres.
 *
 *   TIDLISTA.INPROVEE + TIDSAL.INPROVEE  →  suppliers (code/legal_name/tax_id)
 *   TIDLISTA (proveedor+artículo+precio)  →  supplier_products (relación + costo)
 *
 * El nombre del proveedor vive en CONTERCE ("Maestro de terceros contables"):
 *   CONTERCE.col[2] = NIT del tercero (== INPROVEE)
 *   CONTERCE.col[3] = nombre/razón social
 *
 * Llave natural = NIT (guardado en `suppliers.code` y `suppliers.tax_id`).
 * La relación proveedor→artículo usa `product_variants.sku` == `TIDLISTA.INARTIC`.
 * Idempotente: upsert por `code` y por `(supplier_id, product_variant_id)`.
 * NO se borra nada.
 *
 * Es un sync "manual/bajo demanda" (los proveedores cambian poco y CONTERCE
 * tiene ~765k filas): no va en el ciclo de 5 min del demonio.
 *
 * Uso:
 *   node scripts-agent/erp/sync-suppliers.mjs --dry-run
 *   node scripts-agent/erp/sync-suppliers.mjs
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, n, args, log } from './lib.mjs';

const a = args();
const DRY = !!a['dry-run'];

const erp = createErpClient();
const pg = createPg();
await pg.connect();
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);
const NOW = new Date().toISOString();

async function loadAll(sql, limit = 10000) {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await erp.sql(sql, { limit, offset });
    if (!res.rows.length) break;
    out.push(...res.rows);
    if (res.rows.length < limit) break;
    offset += res.rows.length;
  }
  return out;
}

// ─────────────────────────── 1. suppliers (maestro) ───────────────────────────

// TIDLISTA: una fila por proveedor+artículo. Columnas seleccionadas en orden:
//   INPROVEE, INARTIC, INVALOR, INVALOR1, INACTIVO
log('⏳ Leyendo TIDLISTA (proveedores + relación artículo)…');
const tidlista = await loadAll(
  'SELECT INPROVEE, INARTIC, INVALOR, INVALOR1, INACTIVO FROM tidlista',
  20000,
);

const nits = new Set();
for (const r of tidlista) {
  const v = s(r[0]);
  if (v) nits.add(v);
}
const salNits = await loadAll('SELECT INPROVEE FROM tidsal', 20000);
for (const r of salNits) {
  const v = s(r[0]);
  if (v) nits.add(v);
}
log(`   ${nits.size} NITs de proveedor distintos`);

log('⏳ Leyendo CONTERCE (maestro de terceros)…');
const nameByNit = new Map();
let scanned = 0;
for (let offset = 0; ; offset += 10000) {
  const res = await erp.sql('SELECT * FROM conterce', { limit: 10000, offset });
  if (!res.rows.length) break;
  scanned += res.rows.length;
  for (const row of res.rows) {
    const nit = s(row[2]);
    const name = s(row[3]);
    if (!nit || !nits.has(nit) || nameByNit.has(nit)) continue;
    nameByNit.set(nit, name);
  }
  if (scanned % 100000 === 0) log(`   …${scanned} filas · ${nameByNit.size}/${nits.size} nombres`);
  if (res.rows.length < 10000) break;
  if (nameByNit.size >= nits.size) break;
}
log(`   ${nameByNit.size}/${nits.size} proveedores con nombre`);

const supplierIdByNit = new Map();
let ok = 0;
let miss = 0;
for (const nit of nits) {
  const name = nameByNit.get(nit);
  if (!name) {
    miss++;
    continue;
  }
  if (!DRY) {
    const row = (
      await q(
        `INSERT INTO suppliers (code, legal_name, tax_id, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,true,$4,$4)
         ON CONFLICT (code) DO UPDATE SET legal_name=EXCLUDED.legal_name, tax_id=EXCLUDED.tax_id, is_active=true, deleted_at=NULL, updated_at=EXCLUDED.updated_at
         RETURNING id`,
        [nit.slice(0, 30), name.slice(0, 200), nit.slice(0, 50), NOW],
      )
    ).rows[0];
    supplierIdByNit.set(nit, Number(row.id));
  }
  ok++;
}
log(`🏭 Proveedores: ${nits.size} en ERP · ${ok} sincronizados · ${miss} sin nombre en CONTERCE`);

// ─────────────────────── 2. supplier_products (relación) ───────────────────────

log('⏳ Construyendo mapas supplier_id / variant_id…');
// En dry-run no hicimos el upsert de suppliers: resolvemos ids desde lo ya guardado.
if (supplierIdByNit.size === 0) {
  const rows = (await q('SELECT id, code FROM suppliers WHERE code IS NOT NULL')).rows;
  for (const r of rows) supplierIdByNit.set(s(r.code), Number(r.id));
}
const variantIdBySku = new Map(
  (await q('SELECT id, sku FROM product_variants WHERE sku IS NOT NULL')).rows.map((r) => [
    s(r.sku),
    Number(r.id),
  ]),
);

let spOk = 0;
let spSkipArt = 0;
let spSkipProv = 0;
// Deduplicar por (supplier_id, product_variant_id): TIDLISTA puede traer el
// mismo par más de una vez, y el ON CONFLICT del lote falla si se repite.
const spMap = new Map();
for (const r of tidlista) {
  const nit = s(r[0]);
  const artic = s(r[1]);
  const v1 = n(r[3]); // INVALOR1 (costo con descuento)
  const v0 = n(r[2]); // INVALOR (lista)
  if (!nit || !artic) continue;

  const supplierId = supplierIdByNit.get(nit);
  if (!supplierId) {
    spSkipProv++;
    continue;
  }
  const variantId = variantIdBySku.get(artic);
  if (!variantId) {
    spSkipArt++;
    continue;
  }
  const price = v1 && v1 > 0 ? v1 : v0 && v0 > 0 ? v0 : null;
  spMap.set(`${supplierId}:${variantId}`, [supplierId, variantId, artic.slice(0, 100), price, NOW]);
}
const rows = [...spMap.values()];

if (!DRY && rows.length) {
  // Batching manual (500 por lote) para no exceder límites de parámetros.
  const CHUNK = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const tuples = [];
    const params = [];
    let idx = 0;
    for (const row of chunk) {
      tuples.push(`($${++idx},$${++idx},$${++idx},$${++idx},$${++idx},$${++idx})`);
      params.push(row[0], row[1], row[2], row[3], NOW, NOW);
    }
    await q(
      `INSERT INTO supplier_products (supplier_id, product_variant_id, supplier_sku, purchase_price, created_at, updated_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (supplier_id, product_variant_id) DO UPDATE SET
         supplier_sku=EXCLUDED.supplier_sku, purchase_price=EXCLUDED.purchase_price, updated_at=EXCLUDED.updated_at`,
      params,
    );
    done += chunk.length;
  }
  spOk = done;
}
log(`📦 Relación proveedor→artículo: ${rows.length} filas · ${spSkipArt} artículos sin variante · ${spSkipProv} proveedores sin nombre`);
log(`\n${DRY ? '🧪 DRY-RUN — nada escrito.' : '✅ Proveedores y relación proveedor→artículo sincronizados.'}`);
await pg.end();
