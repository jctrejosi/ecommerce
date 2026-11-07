/**
 * Importa el árbol de categorías y las marcas del ERP sin tocar productos,
 * precios, stock, imágenes ni la activación local.
 *
 *   TIDTAB    → categories / product_categories   (categoría derivada del SKU)
 *   TIDMARCAS → brands / products.brand_id        (TIDSAL.INMARCAP)
 *
 * `TIDSAL.INMARCA` se conserva como atributo `marca-erp` (no se usa como FK:
 * en la copia no coincide con TIDMARCAS.MCODIGO).
 *
 * Uso:
 *   node scripts-agent/erp/sync-categories.mjs            # dry-run
 *   node scripts-agent/erp/sync-categories.mjs --apply
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const PAGE = 5000;
const CHUNK = 500;

const erp = createErpClient();
const pg = createPg();
await pg.connect();
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

const slugify = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

async function insertBatches(table, cols, rows, conflict = '') {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map(
      (row) => `(${row.map((v) => `$${params.push(v)}`).join(',')})`,
    );
    await q(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflict}`,
      params,
    );
  }
}

// ─────────────────────────── ERP → memoria ───────────────────────────

log('⏳ Leyendo TIDTAB…');
const cateRes = await erp.sql('SELECT CTABCOD, CTABDES, CTABCOD1 FROM tidtab', { limit: 10000 });
const catNameByCode = new Map();
const catParentByCode = new Map();
for (const r of cateRes.rows) {
  const code = s(r[0]);
  if (!code) continue;
  catNameByCode.set(code, s(r[1]) || code);
  catParentByCode.set(code, s(r[2]) || null);
}

/** INCATE si existe en TIDTAB; si no, prefijo del SKU (el ERP real lo usa así). */
function categoryOf(artic, incate) {
  const direct = s(incate);
  if (direct && catNameByCode.has(direct)) return direct;
  const sku = s(artic) || '';
  for (let len = Math.min(7, sku.length); len > 0; len--) {
    const code = sku.slice(0, len);
    if (catNameByCode.has(code)) return code;
  }
  return null;
}

log('⏳ Leyendo TIDMARCAS…');
const marcRes = await erp.sql('SELECT MCODIGO, MNOMBRE FROM tidmarcas', { limit: 10000 });
const brandNameByCode = new Map();
for (const r of marcRes.rows) {
  const code = s(r[0]);
  const name = s(r[1]);
  if (code && name) brandNameByCode.set(code, name);
}

log('⏳ Leyendo TIDSAL (INARTIC, INCATE, INMARCAP, INMARCA)…');
const erpArticles = new Map();
let offset = 0;
for (;;) {
  const res = await erp.sql(
    'SELECT INARTIC, INCATE, INMARCAP, INMARCA FROM tidsal',
    { limit: PAGE, offset },
  );
  for (const r of res.rows) {
    const artic = s(r[0]);
    if (!artic || erpArticles.has(artic)) continue;
    erpArticles.set(artic, {
      incate: s(r[1]),
      categoria: categoryOf(artic, r[1]),
      marcap: s(r[2]),
      marca: s(r[3]),
    });
  }
  if (res.rows.length < PAGE) break;
  offset += res.rows.length;
}
log(`   ${erpArticles.size} artículos únicos · ${catNameByCode.size} categorías · ${brandNameByCode.size} marcas`);

// ─────────────────────────── categorías ───────────────────────────

const categoryIdByCode = new Map(
  (await q('SELECT id, code FROM categories WHERE code IS NOT NULL')).rows.map((r) => [
    String(r.code).trim(),
    Number(r.id),
  ]),
);
const cateCodes = new Set(catNameByCode.keys());
for (const x of erpArticles.values()) if (x.categoria) cateCodes.add(x.categoria);

const newCats = [];
for (const code of [...cateCodes].sort((x, y) => x.length - y.length || x.localeCompare(y))) {
  const existed = categoryIdByCode.has(code);
  const name = (catNameByCode.get(code) || `Categoría ERP ${code}`).slice(0, 100);
  const parentCode = catParentByCode.get(code) || null;
  const parentId = parentCode ? categoryIdByCode.get(parentCode) ?? null : null;
  let level = 0;
  for (let cur = parentCode, guard = 0; cur && guard < 20; guard++) {
    level++;
    cur = catParentByCode.get(cur) || null;
  }
  const slug = `${slugify(name) || 'cat'}-${code}`.slice(0, 100);
  if (!APPLY) {
    if (!existed) {
      newCats.push({ code, name, parentId, level, slug });
      categoryIdByCode.set(code, -newCats.length); // id simulado para el resumen
    }
    continue;
  }
  const row = (
    await q(
      `INSERT INTO categories (parent_id, name, slug, code, level, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, code=EXCLUDED.code,
         parent_id=EXCLUDED.parent_id, level=EXCLUDED.level
       RETURNING id`,
      [parentId, name, slug, code, level],
    )
  ).rows[0];
  categoryIdByCode.set(code, Number(row.id));
  if (!existed) newCats.push({ code, name });
}
log(`${APPLY ? '✅' : '🧪'} Categorías nuevas: ${newCats.length}${APPLY ? '' : ' (dry-run)'}`);

// ─────────────────────────── marcas ───────────────────────────

const brandIdByName = new Map(
  (await q('SELECT id, name FROM brands')).rows.map((r) => [
    String(r.name).trim().toLowerCase(),
    Number(r.id),
  ]),
);
const newBrands = [];
for (const [code, name] of brandNameByCode) {
  const key = name.trim().toLowerCase();
  if (!brandIdByName.has(key)) {
    newBrands.push({ code, name });
    if (!APPLY) brandIdByName.set(key, -newBrands.length); // id simulado
  }
  if (!APPLY) continue;
  const slug = `${slugify(name) || 'marca'}-${code}`.slice(0, 100);
  const row = (
    await q(
      `INSERT INTO brands (name, slug, website, description, country, code, is_active)
       VALUES ($1,$2,'','Importado ERP (TIDMARCAS)','',$3,true)
       ON CONFLICT (name) DO UPDATE SET code = COALESCE(brands.code, EXCLUDED.code)
       RETURNING id`,
      [name.trim().slice(0, 100), slug, code],
    )
  ).rows[0];
  brandIdByName.set(key, Number(row.id));
}
// Marcas que sólo aparecen en TIDSAL.INMARCAP.
for (const x of erpArticles.values()) {
  const name = x.marcap;
  if (!name) continue;
  const key = name.trim().toLowerCase();
  if (brandIdByName.has(key)) continue;
  newBrands.push({ code: null, name });
  if (!APPLY) {
    brandIdByName.set(key, -newBrands.length);
    continue;
  }
  const slug = `${slugify(name) || 'marca'}-${brandIdByName.size}`.slice(0, 100);
  const row = (
    await q(
      `INSERT INTO brands (name, slug, website, description, country, code, is_active)
       VALUES ($1,$2,'','Importado ERP (TIDSAL.INMARCAP)','',NULL,true)
       ON CONFLICT (name) DO UPDATE SET name = brands.name
       RETURNING id`,
      [name.trim().slice(0, 100), slug],
    )
  ).rows[0];
  brandIdByName.set(key, Number(row.id));
}
log(`${APPLY ? '✅' : '🧪'} Marcas nuevas: ${newBrands.length}${APPLY ? '' : ' (dry-run)'}`);

// ─────────────────────────── asignaciones ───────────────────────────

const products = (
  await q('SELECT id, external_id, brand_id FROM products WHERE external_id IS NOT NULL')
).rows;
const byExternal = new Map(products.map((p) => [String(p.external_id), p]));

const catRows = [];
const brandRows = [];
const catAttrRows = [];
const brandAttrRows = [];
let noCategory = 0;
let noBrand = 0;
let notInErp = 0;

for (const p of products) {
  const erpArt = erpArticles.get(String(p.external_id));
  if (!erpArt) {
    notInErp++;
    continue;
  }
  const catId = erpArt.categoria ? categoryIdByCode.get(erpArt.categoria) : null;
  if (catId) catRows.push([p.id, catId]);
  else noCategory++;

  const brandId = erpArt.marcap
    ? brandIdByName.get(erpArt.marcap.trim().toLowerCase()) ?? null
    : null;
  if (brandId) brandRows.push([p.id, brandId]);
  else noBrand++;

  if (erpArt.marca) brandAttrRows.push([p.id, erpArt.marca]);
  if (erpArt.categoria) catAttrRows.push([p.id, erpArt.categoria]);
}
log(
  `   productos: ${products.length} · con categoría: ${catRows.length} · sin categoría: ${noCategory} · ` +
    `con marca: ${brandRows.length} · sin marca: ${noBrand} · no están en TIDSAL: ${notInErp}`,
);

if (APPLY) {
  log('⏳ Reemplazando product_categories…');
  await q(
    `DELETE FROM product_categories pc USING products p
      WHERE pc.product_id = p.id AND p.external_id IS NOT NULL`,
  );
  await insertBatches(
    'product_categories',
    ['product_id', 'category_id'],
    catRows,
    'ON CONFLICT DO NOTHING',
  );

  log('⏳ Actualizando products.brand_id…');
  for (let i = 0; i < brandRows.length; i += CHUNK) {
    const chunk = brandRows.slice(i, i + CHUNK);
    await q(
      `UPDATE products p SET brand_id = v.brand_id, updated_at = now()
         FROM unnest($1::bigint[], $2::bigint[]) AS v(product_id, brand_id)
        WHERE p.id = v.product_id`,
      [chunk.map((r) => r[0]), chunk.map((r) => r[1])],
    );
  }

  // Atributos espejo del ERP.
  const attrIds = (
    await q("SELECT id, slug FROM attributes WHERE slug IN ('categoria-erp','marca-erp')")
  ).rows;
  const attrId = new Map(attrIds.map((r) => [r.slug, Number(r.id)]));
  if (!attrId.has('marca-erp')) {
    const row = (
      await q(
        `INSERT INTO attributes (name, slug, is_active)
         VALUES ('Código de marca ERP (INMARCA)','marca-erp',true)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      )
    ).rows[0];
    attrId.set('marca-erp', Number(row.id));
  }
  for (const [slug, rows] of [
    ['categoria-erp', catAttrRows],
    ['marca-erp', brandAttrRows],
  ]) {
    const id = attrId.get(slug);
    if (!id) continue;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const ids = rows.slice(i, i + CHUNK).map((r) => r[0]);
      await q(
        `DELETE FROM product_attributes WHERE attribute_id=$1 AND product_id = ANY($2::bigint[])`,
        [id, ids],
      );
    }
    await insertBatches(
      'product_attributes',
      ['product_id', 'attribute_id', 'custom_value'],
      rows.map((r) => [r[0], id, r[1].slice(0, 255)]),
    );
  }

  // Ocultar categorías viejas que ya no tengan productos ni referencias.
  const hidden = await q(
    `UPDATE categories c SET is_active=false, updated_at=now()
      WHERE c.code IS NOT NULL AND c.is_active
        AND NOT (c.code = ANY($1::text[]))
        AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.category_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM shelf_categories sc WHERE sc.category_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM saved_filters sf WHERE sf.category_ids @> to_jsonb(c.id))`,
    [[...cateCodes]],
  );
  log(`   categorías antiguas ocultas: ${hidden.rowCount}`);
}

if (!APPLY) {
  log('\n🧪 DRY-RUN — nada escrito. Muestra de categorías nuevas:');
  for (const c of newCats.slice(0, 8)) log(`   ${c.code} → ${c.name} (parent ${c.parentId ?? '—'})`);
  log('   Usa --apply para escribir.');
}

await pg.end();
