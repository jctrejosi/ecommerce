/**
 * Sincroniza el catálogo del ERP (Advantage) hacia Postgres del ecommerce.
 *
 *   ERP (TIDSAL + maestras)  →  products / product_variants / prices /
 *                               inventory / branch_products + marcas, tipos,
 *                               categorías, atributos e impuestos.
 *
 * Cómo funciona (modelo "diff por huella", plan B de docs/PLAN-INTEGRACION-ERP.md):
 *   1. Lee TIDSAL proyectando las columnas necesarias, paginando por `offset`.
 *   2. Calcula un hash (huella) por fila. Las filas cuya huella coincide con
 *      `erp_snapshot` se consideran sin cambios y se saltan.
 *   3. Para los artículos con al menos una fila cambiada, hace UPSERT en
 *      Postgres (producto por `external_id`, variante por `sku`, precios por
 *      variante+sucursal, inventario por variante+sucursal, etc.).
 *   4. Actualiza `erp_snapshot` con las huellas leídas.
 *
 * Mapeo de campos: docs/PLAN-INTEGRACION-ERP.md §4.1.
 *   Marca   : INMARCAP (nombre real; coincide con TIDMARCAS.MNOMBRE).
 *             Respaldo: INMARCA (código MCODIGO) resuelto por erp_code_map.
 *             OJO: INMARCA viene poblado en el 100% de las filas pero apunta a
 *             marcas sin relación con el artículo → NO se usa como fuente.
 *   Tipo    : INTIPO → product_types (vía erp_code_map domain 'product_type').
 *   Categoría: INCATE si existe en TIDTAB; si no, prefijo del SKU (7→2 dígitos).
 *   Stock   : INSALDO00 (real) por defecto; `--stock-default=N` para fijar N.
 *   Precios : INVRVENTA1 (venta) / INVRVENTA0 (precio "antes").
 *   Impuesto: INTIMP (J→IVA19, C→IVA5, E→EXENTO).
 *
 * Uso:
 *   node scripts-agent/erp/sync-catalog.mjs --dry-run
 *   node scripts-agent/erp/sync-catalog.mjs --limit=3000
 *   node scripts-agent/erp/sync-catalog.mjs
 *   node scripts-agent/erp/sync-catalog.mjs --stock-default=999
 *   node scripts-agent/erp/sync-catalog.mjs --reset-snapshot   (re-sincroniza todo)
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, n, sha1, args, log } from './lib.mjs';

const a = args();
const DRY = !!a['dry-run'];
const RESET_SNAP = !!a['reset-snapshot'];
const LIMIT = a.limit ? Number(a.limit) : Infinity;
const PAGE = Number(a.page || 5000);
const STOCK_DEFAULT = a['stock-default'] ? Number(a['stock-default']) : null;
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 1);

const TAX_BY_TIPO_IMP = { J: 'IVA19', C: 'IVA5', E: 'EXENTO' };

const COLS = [
  'INSUC', 'INBODEGA', 'INARTIC', 'NUMERO', 'INEAN', 'INNOMBRE', 'INNOMBRE3',
  'INNOMBRE4', 'INUNIDAD', 'INPROVEE', 'INTIPO', 'INEMBALAJE', 'INVRVENTA1',
  'INVRVENTA0', 'INTIMP', 'INMINIMO', 'INMAXIMO', 'INVRULTC', 'INUBIC',
  'INCOSTO00', 'INSALDO00', 'INMARCA', 'INMARCAP', 'INPRESEN', 'INACTIVO',
  'INFECHA', 'INPTOPOS', 'INEAN14', 'INCUM', 'ININVIMA', 'INWEB', 'INPARTE',
  'INALTO', 'INANCHO', 'INLARGO', 'INCATE',
];
const SQL_TIDSAL = `SELECT ${COLS.join(', ')} FROM tidsal`;

// ─────────────────────────────── helpers ───────────────────────────────

const slugify = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

const branchCode = (insuc) => {
  const raw = String(insuc ?? '').trim();
  // asqlcmd devuelve los numéricos como "1.000000000000000".
  const num = Number(raw);
  if (Number.isFinite(num)) return String(Math.trunc(num));
  return raw.replace(/^0+/, '') || '0';
};

const int = (v, def = 0) => {
  const x = n(v);
  return x === null ? def : Math.round(x);
};

async function insertBatches(pg, table, cols, rows, conflict = '') {
  const CHUNK = 500;
  let done = 0;
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
    done += chunk.length;
  }
  return done;
}

async function deleteIn(pg, table, col, ids) {
  if (!ids.length) return 0;
  const r = await pg.query(`DELETE FROM ${table} WHERE ${col} = ANY($1::bigint[])`, [ids]);
  return r.rowCount;
}

// ─────────────────────────────── conexión ───────────────────────────────

const erp = createErpClient();
const pg = createPg();
await pg.connect();
// Los cambios que hacemos aquí vienen DEL ERP: no deben reencolarse al ERP
// (triggers de la migración 21).
await pg.query("SET app.erp_sync = 'on'");
const q = (text, params) => pg.query(text, params);
const one = async (text, params) => (await pg.query(text, params)).rows[0];

// ─────────────────────────────── referencias ───────────────────────────────

const taxRows = (await q('SELECT id, code FROM tax_rates')).rows;
const taxIdByCode = new Map(taxRows.map((t) => [String(t.code).trim(), Number(t.id)]));
for (const c of Object.values(TAX_BY_TIPO_IMP))
  if (!taxIdByCode.has(c)) throw new Error(`Falta tax_rate ${c}`);
const fallbackTaxId = taxIdByCode.get('IVA19');

const storeId = (await one('SELECT id FROM store ORDER BY id LIMIT 1')).id;

const cmRows = (
  await q("SELECT domain, erp_value, label FROM erp_code_map WHERE domain IN ('brand','product_type')")
).rows;
const brandNameByCode = new Map();
for (const r of cmRows) {
  if (r.domain !== 'brand') continue;
  const code = String(r.erp_value).trim();
  const name = String(r.label || '').trim();
  brandNameByCode.set(code, name);
}
const typeNameByCode = new Map(
  cmRows.filter((r) => r.domain === 'product_type').map((r) => [String(r.erp_value).trim(), String(r.label || '').trim()]),
);
log(`Referencias: ${brandNameByCode.size} marcas ERP, ${typeNameByCode.size} tipos ERP, ${taxIdByCode.size} impuestos`);

// Árbol de categorías TIDTAB (el que usa el ERP real y la web).
// TIDSAL.INCATE no es fiable (vacío en la mayoría de filas y códigos viejos);
// la categoría del artículo se deriva del prefijo de INARTIC.
const cate = await erp.sql('SELECT CTABCOD, CTABDES, CTABCOD1 FROM tidtab', { limit: 10000 });
const catNameByCode = new Map();
const catParentByCode = new Map();
for (const r of cate.rows) {
  const code = s(r[0]);
  if (!code) continue;
  catNameByCode.set(code, s(r[1]) || code);
  catParentByCode.set(code, s(r[2]) || null);
}
log(`Categorías TIDTAB: ${catNameByCode.size} nodos`);

/** Código de categoría: INCATE si existe en TIDTAB; si no, prefijo del SKU. */
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

// ─────────────────────────── lectura de TIDSAL ───────────────────────────

log(`⏳ Leyendo TIDSAL (${COLS.length} columnas)…`);
const articles = new Map(); // artic -> master + branches
const rowHashes = new Map(); // key -> { hash, fecha }
const sucursales = new Set();

let offset = 0;
let read = 0;
for (;;) {
  const res = await erp.sql(SQL_TIDSAL, { limit: PAGE, offset });
  const { cols, rows } = res;
  if (!rows.length) break;
  const ix = new Map(cols.map((c, i) => [c, i]));
  const g = (row, name) => row[ix.get(name)];

  for (const row of rows) {
    const artic = s(g(row, 'INARTIC'));
    if (!artic) continue;
    read++;
    const insuc = branchCode(g(row, 'INSUC'));
    const bodega = s(g(row, 'INBODEGA')) || '';
    const key = `${insuc}|${bodega}|${artic}`;
    rowHashes.set(key, {
      hash: sha1(COLS.map((c) => s(g(row, c)))),
      fecha: n(g(row, 'INFECHA')),
    });
    sucursales.add(insuc);

    const activo = s(g(row, 'INACTIVO')) === 'A';
    const web = s(g(row, 'INWEB')) === 'T';
    const v1 = int(g(row, 'INVRVENTA1'));
    const v0 = int(g(row, 'INVRVENTA0'));
    const ean = s(g(row, 'INEAN')) || null;

    let p = articles.get(artic);
    if (!p) {
      const numero = int(g(row, 'NUMERO'));
      p = {
        artic,
        nombre: s(g(row, 'INNOMBRE')) || artic,
        nombre3: s(g(row, 'INNOMBRE3')) || null,
        nombre4: s(g(row, 'INNOMBRE4')) || null,
        ean,
        unidad: s(g(row, 'INUNIDAD')) || null,
        present: s(g(row, 'INPRESEN')) || null,
        empaque: int(g(row, 'INEMBALAJE')) || null,
        ean14: s(g(row, 'INEAN14')) || null,
        parte: s(g(row, 'INPARTE')) || null,
        invima: s(g(row, 'ININVIMA')) || null,
        cum: s(g(row, 'INCUM')) || null,
        ubic: s(g(row, 'INUBIC')) || null,
        incate: s(g(row, 'INCATE')) || null,
        categoria: categoryOf(artic, g(row, 'INCATE')),
        tipo: s(g(row, 'INTIPO')) || null,
        tipoImp: s(g(row, 'INTIMP')) || null,
        marcap: s(g(row, 'INMARCAP')) || null,
        marca: s(g(row, 'INMARCA')) || null,
        plu: numero > 0 ? String(numero) : null,
        cost: n(g(row, 'INVRULTC')) ?? n(g(row, 'INCOSTO00')) ?? 0,
        largo: n(g(row, 'INLARGO')) || 0,
        ancho: n(g(row, 'INANCHO')) || 0,
        alto: n(g(row, 'INALTO')) || 0,
        activo: false,
        web: false,
        branches: new Map(),
      };
      articles.set(artic, p);
    }
    p.activo = p.activo || activo;
    p.web = p.web || web;
    p.branches.set(insuc, {
      artic,
      v1,
      v0,
      web,
      activo,
      saldo: int(g(row, 'INSALDO00')),
      minimo: Math.max(0, int(g(row, 'INMINIMO'))),
      maximo: Math.max(0, int(g(row, 'INMAXIMO'))),
      reorder: Math.max(0, int(g(row, 'INPTOPOS'))),
    });
    if (read >= LIMIT) break;
  }
  if (read >= LIMIT || rows.length < PAGE) break;
  offset += rows.length;
}
log(`   ${read} filas | ${articles.size} artículos | ${sucursales.size} sucursales`);

// EAN duplicados -> null (el esquema exige unicidad). Se cuenta por ARTÍCULO
// (no por fila): un artículo en 3 sucursales comparte la misma EAN.
const eanCount = new Map();
for (const p of articles.values())
  if (p.ean) eanCount.set(p.ean, (eanCount.get(p.ean) || 0) + 1);
let eanDropped = 0;
for (const p of articles.values())
  if (p.ean && eanCount.get(p.ean) > 1) { p.ean = null; eanDropped++; }

// ─────────────────────────── diff vs erp_snapshot ───────────────────────────

if (RESET_SNAP && !DRY) await q("DELETE FROM erp_snapshot WHERE erp_table = 'TIDSAL'");
const snap = new Map(
  (await q("SELECT erp_key, hash FROM erp_snapshot WHERE erp_table = 'TIDSAL'")).rows.map((r) => [r.erp_key, r.hash]),
);
const changedArticles = new Set();
let changedRows = 0;
for (const [key, v] of rowHashes) {
  if (snap.get(key) !== v.hash) {
    changedRows++;
    changedArticles.add(key.split('|')[2]);
  }
}
log(`Diff: ${changedRows} filas cambiadas en ${changedArticles.size} artículos`);

const todo = [...articles.values()].filter((p) => changedArticles.has(p.artic));

// ─────────────────────────────── dry-run ───────────────────────────────

if (DRY) {
  log(`\n🧪 DRY-RUN — nada escrito.`);
  log(`   artículos totales        : ${articles.size}`);
  log(`   artículos a tocar        : ${todo.length}`);
  log(`   marcas referenciadas     : ${new Set(todo.map((p) => p.marcap).filter(Boolean)).size}`);
  log(`   tipos referenciados      : ${new Set(todo.map((p) => p.tipo).filter(Boolean)).size}`);
  log(`   categorías distintas     : ${new Set(todo.map((p) => p.categoria).filter(Boolean)).size}`);
  log(`   precios (var×suc)        : ${todo.reduce((s2, p) => s2 + [...p.branches.values()].filter((d) => d.v1 > 0).length, 0)}`);
  log(`   inventario (var×suc)     : ${todo.reduce((s2, p) => s2 + p.branches.size, 0)}`);
  log(`   stock                    : ${STOCK_DEFAULT === null ? 'INSALDO00 (real)' : STOCK_DEFAULT}`);
  log(`   EAN duplicados -> null   : ${eanDropped}`);
  await pg.end();
  process.exit(0);
}

if (!todo.length) {
  log('✅ Sin cambios que aplicar.');
  await pg.end();
  process.exit(0);
}

// ─────────────────────────── sucursales ───────────────────────────

const branchIdByCode = new Map();
for (const code of [...sucursales].sort()) {
  const row = (
    await q(
      `INSERT INTO branches
         (code, name, address, city, phone, store_id, email, manager_name, manager_phone, branch_type, location, is_active)
       VALUES ($1,$2,'PENDIENTE (ERP)','Manizales','0000000',$3,$4,'PENDIENTE','0000000','STORE','0,0',true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [code, `TID Sucursal ${code}`, storeId, `sucursal${code}@pendiente.local`],
    )
  ).rows[0];
  branchIdByCode.set(code, Number(row.id));
}
log('🏬 Sucursales:', [...branchIdByCode.entries()].map(([c, id]) => `${c}=${id}`).join(', '));

// ─────────────────────────── marcas (TIDMARCAS) ───────────────────────────

// INMARCAP es el nombre de marca que usa TIDSAL. INMARCA no se usa como FK:
// en la copia no coincide con TIDMARCAS.MCODIGO (ver docs/ESCRITURA-FORTUNER-READINESS.md).
const brandNameOf = (p) => s(p.marcap) || null;

const brandIdByName = new Map(
  (await q('SELECT id, name FROM brands')).rows.map((b) => [String(b.name).trim().toLowerCase(), Number(b.id)]),
);
let brandsCreated = 0;

// 1) Todas las marcas del ERP (TIDMARCAS → erp_code_map domain=brand).
for (const [code, name] of brandNameByCode) {
  const clean = s(name);
  if (!clean) continue;
  const key = clean.toLowerCase();
  if (!brandIdByName.has(key)) brandsCreated++;
  const slug = `${slugify(clean) || 'marca'}-${code}`.slice(0, 100);
  const row = (
    await q(
      `INSERT INTO brands (name, slug, website, description, country, code, is_active)
       VALUES ($1,$2,'','Importado ERP (TIDMARCAS)','',$3,true)
       ON CONFLICT (name) DO UPDATE SET code = COALESCE(brands.code, EXCLUDED.code)
       RETURNING id`,
      [clean.slice(0, 100), slug, code],
    )
  ).rows[0];
  brandIdByName.set(key, Number(row.id));
}
log(`🏷️  Marcas TIDMARCAS: ${brandNameByCode.size} en ERP, +${brandsCreated} nuevas`);

// 2) Marcas referenciadas por INMARCAP que no estén en TIDMARCAS.
const referencedBrands = [...new Set(todo.map(brandNameOf).filter(Boolean))];
for (const name of referencedBrands) {
  const key = name.trim().toLowerCase();
  if (brandIdByName.has(key)) continue;
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
  brandsCreated++;
}
log(`🏷️  Marcas referenciadas: ${referencedBrands.length} · total creadas: ${brandsCreated}`);
const brandIdOf = (p) => {
  const name = brandNameOf(p);
  return name ? brandIdByName.get(name.trim().toLowerCase()) ?? null : null;
};

// ─────────────────────────── categorías (TIDTAB) ───────────────────────────

const categoryIdByCode = new Map(
  (await q('SELECT id, code FROM categories WHERE code IS NOT NULL')).rows.map((c) => [String(c.code).trim(), Number(c.id)]),
);
// Todos los nodos del árbol TIDTAB + categorías derivadas de los SKU.
const cateCodes = new Set(catNameByCode.keys());
for (const p of todo) if (p.categoria) cateCodes.add(p.categoria);
let catsCreated = 0;
for (const code of [...cateCodes].sort((x, y) => x.length - y.length || x.localeCompare(y))) {
  if (categoryIdByCode.has(code)) continue;
  const baseName = (catNameByCode.get(code) || `Categoría ERP ${code}`).slice(0, 100);
  // Jerarquía explícita de TIDTAB (CTABCOD1).
  const parentCode = catParentByCode.get(code) || null;
  const parentId = parentCode ? categoryIdByCode.get(parentCode) ?? null : null;
  const slug = `${slugify(baseName) || 'cat'}-${code}`.slice(0, 100);
  let level = 0;
  for (let cur = parentCode, guard = 0; cur && guard < 20; guard++) {
    level++;
    cur = catParentByCode.get(cur) || null;
  }
  const row = (
    await q(
      `INSERT INTO categories (parent_id, name, slug, code, level, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name,
         code = EXCLUDED.code, parent_id = EXCLUDED.parent_id, level = EXCLUDED.level
       RETURNING id`,
      [parentId, baseName, slug, code, level],
    )
  ).rows[0];
  categoryIdByCode.set(code, Number(row.id));
  catsCreated++;
}
log(`🌳 Categorías TIDTAB: ${catNameByCode.size} en ERP, +${catsCreated} nuevas`);

// ─────────────────────────── tipos de producto ───────────────────────────

const typeIdByCode = new Map(
  (await q('SELECT id, code FROM product_types')).rows.map((t) => [String(t.code).trim(), Number(t.id)]),
);
let typesCreated = 0;
for (const code of new Set(todo.map((p) => p.tipo).filter(Boolean))) {
  if (typeIdByCode.has(code)) continue;
  const name = (typeNameByCode.get(code) || `Tipo ${code}`).slice(0, 100);
  const row = (
    await q(
      `INSERT INTO product_types (code, name, description, is_active)
       VALUES ($1,$2,'Importado ERP',true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [code.slice(0, 10), name],
    )
  ).rows[0];
  typeIdByCode.set(code, Number(row.id));
  typesCreated++;
}
log(`🆔 Tipos de producto: +${typesCreated}`);

// ─────────────────────────── atributos ───────────────────────────

const ATTR_DEFS = [
  ['Unidad de medida', 'unidad-medida', (p) => p.unidad],
  ['Presentación', 'presentacion', (p) => p.present],
  ['Nombre corto', 'nombre-corto', (p) => p.nombre3],
  ['Nombre largo (factura)', 'nombre-largo', (p) => p.nombre4],
  ['Unidades por empaque', 'unidades-empaque', (p) => p.empaque],
  ['EAN caja (EAN-14)', 'ean-caja', (p) => p.ean14],
  ['Referencia fabricante', 'referencia-fabricante', (p) => p.parte],
  ['Registro sanitario INVIMA', 'registro-invima', (p) => p.invima],
  ['CUM', 'cum', (p) => p.cum],
  ['Ubicación bodega', 'ubicacion-bodega', (p) => p.ubic],
  ['Categoría ERP (TIDTAB/SKU)', 'categoria-erp', (p) => p.categoria],
  ['Código de marca ERP (INMARCA)', 'marca-erp', (p) => p.marca],
];
const attrIdBySlug = new Map(
  (await q('SELECT id, slug FROM attributes')).rows.map((r) => [r.slug, Number(r.id)]),
);
for (const [name, slug] of ATTR_DEFS) {
  if (attrIdBySlug.has(slug)) continue;
  const row = (
    await q(
      `INSERT INTO attributes (name, slug, is_active) VALUES ($1,$2,true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [name, slug],
    )
  ).rows[0];
  attrIdBySlug.set(slug, Number(row.id));
}

// ─────────────────────────── productos ───────────────────────────

const now = new Date().toISOString();
const buildDescription = (p) => {
  const base = p.nombre4 || p.nombre;
  const parts = [];
  const brand = brandNameOf(p);
  if (brand) parts.push(`Marca: ${brand}`);
  if (p.present) parts.push(`Presentación: ${p.present}`);
  if (p.empaque) parts.push(`Empaque: ${p.empaque} un.`);
  if (p.invima) parts.push(`Reg. INVIMA: ${p.invima}`);
  return parts.length ? `${base} · ${parts.join(' · ')}` : base;
};

log(`⏳ Upsert de ${todo.length} productos…`);
await insertBatches(
  pg,
  'products',
  ['external_id', 'brand_id', 'plu', 'name', 'slug', 'description', 'product_type', 'sku_prefix',
   'manufacturer', 'visibility', 'is_public', 'is_active', 'published_at', 'updated_at'],
  todo.map((p) => [
    p.artic, brandIdOf(p), p.plu, p.nombre.slice(0, 255),
    `${slugify(p.nombre) || 'producto'}-${p.artic}`.slice(0, 255),
    buildDescription(p), 'SIMPLE', p.artic.slice(0, 6),
    brandNameOf(p), 'PUBLIC', p.web, p.activo, now, now,
  ]),
  // Merge no destructivo: si el ERP no trae el campo (NULL), se conserva el
  // valor que ya exista en Postgres. Imágenes, banners, popups y demás datos
  // locales viven en otras tablas y NO se tocan.
  `ON CONFLICT (external_id) WHERE (external_id IS NOT NULL AND deleted_at IS NULL)
   DO UPDATE SET brand_id=COALESCE(EXCLUDED.brand_id, products.brand_id),
     plu=COALESCE(EXCLUDED.plu, products.plu), name=COALESCE(EXCLUDED.name, products.name),
     slug=COALESCE(EXCLUDED.slug, products.slug),
     description=COALESCE(EXCLUDED.description, products.description),
     sku_prefix=COALESCE(EXCLUDED.sku_prefix, products.sku_prefix),
     manufacturer=COALESCE(EXCLUDED.manufacturer, products.manufacturer),
     is_public=EXCLUDED.is_public, is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at`,
);

const productIdByArtic = new Map(
  (await q('SELECT id, external_id FROM products WHERE external_id IS NOT NULL')).rows.map((r) => [r.external_id, Number(r.id)]),
);

// ─────────────────────────── variantes ───────────────────────────

log('⏳ Upsert de variantes…');
await insertBatches(
  pg,
  'product_variants',
  ['product_id', 'sku', 'barcode', 'current_price', 'current_compare_price', 'cost_price',
   'length_mm', 'width_mm', 'height_mm', 'is_active', 'updated_at'],
  todo.map((p) => {
    const primary = [...p.branches.keys()].sort((x, y) => Number(x) - Number(y))[0];
    const d = p.branches.get(primary);
    const cmp = d.v0 > 0 && d.v0 <= d.v1 ? d.v0 : null;
    return [
      productIdByArtic.get(p.artic), p.artic, p.ean,
      String(d.v1 || 0), cmp === null ? null : String(cmp),
      p.cost > 0 ? p.cost.toFixed(2) : null,
      p.largo > 0 ? Math.round(p.largo * 10) : null,
      p.ancho > 0 ? Math.round(p.ancho * 10) : null,
      p.alto > 0 ? Math.round(p.alto * 10) : null,
      true, now,
    ];
  }),
  // Merge no destructivo: barcode/costo/dimensiones/comparativo solo se
  // sobrescriben si el ERP trae un valor; si no, se conserva el local.
  `ON CONFLICT (sku) DO UPDATE SET product_id=EXCLUDED.product_id,
     barcode=COALESCE(EXCLUDED.barcode, product_variants.barcode),
     current_price=COALESCE(NULLIF(EXCLUDED.current_price, 0), product_variants.current_price),
     current_compare_price=COALESCE(EXCLUDED.current_compare_price, product_variants.current_compare_price),
     cost_price=COALESCE(EXCLUDED.cost_price, product_variants.cost_price),
     length_mm=COALESCE(EXCLUDED.length_mm, product_variants.length_mm),
     width_mm=COALESCE(EXCLUDED.width_mm, product_variants.width_mm),
     height_mm=COALESCE(EXCLUDED.height_mm, product_variants.height_mm),
     is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at`,
);

const variantBySku = new Map(
  (await q('SELECT id, sku FROM product_variants')).rows.map((r) => [r.sku, Number(r.id)]),
);

// ─────────────────────────── precios / inventario / sucursal ───────────────────────────

log('⏳ Precios, inventario y disponibilidad por sucursal…');
const priceRows = [];
const invRows = [];
const bpRows = [];
for (const p of todo) {
  const pid = productIdByArtic.get(p.artic);
  const vid = variantBySku.get(p.artic);
  if (!pid || !vid) continue;
  for (const [code, d] of p.branches) {
    const bid = branchIdByCode.get(code);
    if (!bid) continue;
    if (d.v1 > 0) {
      const cmp = d.v0 > 0 && d.v0 <= d.v1 ? d.v0 : null;
      priceRows.push([
        vid, bid, String(d.v1), cmp === null ? null : String(cmp),
        p.cost > 0 ? p.cost.toFixed(2) : null, ADMIN_USER_ID, 'Sync ERP',
      ]);
    }
    const stock = STOCK_DEFAULT === null ? Math.max(0, d.saldo) : STOCK_DEFAULT;
    const maxStock = Math.max(d.maximo, d.minimo);
    invRows.push([vid, bid, stock, d.reorder, d.minimo, maxStock, now]);
    bpRows.push([bid, pid, d.web, d.activo, now]);
  }
}

await insertBatches(
  pg,
  'prices',
  ['product_variant_id', 'branch_id', 'price', 'compare_price', 'cost', 'changed_by', 'change_reason', 'created_at'],
  priceRows.map((r) => [...r, now]),
  `ON CONFLICT (product_variant_id, branch_id) WHERE (end_date IS NULL AND branch_id IS NOT NULL)
   DO UPDATE SET price=EXCLUDED.price, compare_price=EXCLUDED.compare_price,
     cost=COALESCE(EXCLUDED.cost, prices.cost),
     changed_by=EXCLUDED.changed_by, change_reason=EXCLUDED.change_reason, version=prices.version + 1`,
);

await insertBatches(
  pg,
  'inventory',
  ['product_variant_id', 'branch_id', 'stock', 'reorder_point', 'minimum_stock', 'maximum_stock', 'updated_at'],
  invRows,
  `ON CONFLICT (product_variant_id, branch_id) DO UPDATE SET stock=EXCLUDED.stock,
     reorder_point=EXCLUDED.reorder_point, minimum_stock=EXCLUDED.minimum_stock,
     maximum_stock=EXCLUDED.maximum_stock, updated_at=EXCLUDED.updated_at`,
);

await insertBatches(
  pg,
  'branch_products',
  ['branch_id', 'product_id', 'is_public', 'is_available', 'updated_at'],
  bpRows,
  `ON CONFLICT (branch_id, product_id) DO UPDATE SET is_public=EXCLUDED.is_public,
     is_available=EXCLUDED.is_available, updated_at=EXCLUDED.updated_at`,
);

// ─────────────────────────── relaciones (replace) ───────────────────────────

log('⏳ Categorías, tipos, impuestos y atributos…');
const touchedIds = todo.map((p) => productIdByArtic.get(p.artic)).filter(Boolean);
for (const t of ['product_categories', 'product_type_assignments', 'product_tax_classes', 'product_attributes'])
  await deleteIn(pg, t, 'product_id', touchedIds);

const catRows = [];
const typeRows = [];
const taxRowsAssign = [];
const attrRows = [];
for (const p of todo) {
  const pid = productIdByArtic.get(p.artic);
  if (!pid) continue;
  const catId = categoryIdByCode.get(p.categoria);
  if (catId) catRows.push([pid, catId]);
  const typeId = p.tipo ? typeIdByCode.get(p.tipo) : null;
  if (typeId) typeRows.push([pid, typeId]);
  const taxId = taxIdByCode.get(TAX_BY_TIPO_IMP[p.tipoImp] ?? '') ?? fallbackTaxId;
  if (taxId) taxRowsAssign.push([pid, taxId, ADMIN_USER_ID]);
  for (const [, slug, get] of ATTR_DEFS) {
    const val = get(p);
    if (val !== null && val !== undefined && val !== '')
      attrRows.push([pid, attrIdBySlug.get(slug), String(val).slice(0, 255), now, now]);
  }
}
await insertBatches(pg, 'product_categories', ['product_id', 'category_id'], catRows, 'ON CONFLICT DO NOTHING');
await insertBatches(pg, 'product_type_assignments', ['product_id', 'product_type_id'], typeRows, 'ON CONFLICT DO NOTHING');
await insertBatches(pg, 'product_tax_classes', ['product_id', 'tax_rate_id', 'assigned_by'], taxRowsAssign);
await insertBatches(pg, 'product_attributes', ['product_id', 'attribute_id', 'custom_value', 'created_at', 'updated_at'], attrRows);

// Categorías web viejas (p. ej. árbol anterior de 6 dígitos) que ya no usa
// ningún producto ni estantería: se ocultan para que no ensucien el catálogo.
const hiddenCats = await pg.query(
  `UPDATE categories c SET is_active=false, updated_at=now()
    WHERE c.code IS NOT NULL AND c.is_active
      AND NOT (c.code = ANY($1::text[]))
      AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.category_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM shelf_categories sc WHERE sc.category_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM saved_filters sf WHERE sf.category_ids @> to_jsonb(c.id))`,
  [[...cateCodes]],
);
log(`   categorías viejas ocultas: ${hiddenCats.rowCount}`);

// ─────────────────────────── snapshot ───────────────────────────

log('⏳ Actualizando erp_snapshot…');
const snapRows = [...rowHashes.entries()].map(([key, v]) => [key, v.hash]);
const CH = 500;
for (let i = 0; i < snapRows.length; i += CH) {
  const chunk = snapRows.slice(i, i + CH);
  let idx = 0;
  const params = [];
  const tuples = chunk.map(([k, h]) => {
    params.push(k, h, 'TIDSAL');
    return `($${++idx},$${++idx},$${++idx},now())`;
  });
  // OJO: los placeholders deben numerarse en el orden en que se empujan
  // los valores (k, h, 'TIDSAL') por cada fila.
  await pg.query(
    `INSERT INTO erp_snapshot (erp_key, hash, erp_table, synced_at)
     VALUES ${tuples.join(',')}
     ON CONFLICT (erp_key, erp_table) DO UPDATE SET hash=EXCLUDED.hash, synced_at=now()`,
    params,
  );
}

// ─────────────────────────── resumen ───────────────────────────

const counts = await one(
  `SELECT (SELECT count(*)::int FROM products) products,
          (SELECT count(*)::int FROM product_variants) variants,
          (SELECT count(*)::int FROM prices) prices,
          (SELECT count(*)::int FROM inventory) inventory,
          (SELECT count(*)::int FROM branch_products) branch_products,
          (SELECT count(*)::int FROM brands) brands,
          (SELECT count(*)::int FROM product_types) product_types,
          (SELECT count(*)::int FROM product_attributes) product_attributes`,
);
log('\n✅ Sync terminado');
log(counts);
log(`   artículos tocados: ${todo.length} | filas: ${changedRows} | marcas nuevas: ${brandsCreated} | EAN dup->null: ${eanDropped}`);

await pg.end();
