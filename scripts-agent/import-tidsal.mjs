#!/usr/bin/env node
/**
 * Importa el catálogo TID (TIDSAL.adt) a la base Postgres del ecommerce.
 *
 * - Lee los .adt (Advantage) directamente, sin pasar filas por el chat.
 * - Producto = único por INARTIC; la sucursal entra en inventory/branch_products/prices.
 * - Categorías <- TIDTAB (árbol), por prefijos de INARTIC (1/3/5/7 dígitos).
 * - Tipos de producto <- TIPOS_PRODUCTOS.JSON (códigos INTIPO).
 * - Stock: valor por defecto (999), no se importa el saldo real.
 *
 * Uso:
 *   node scripts-agent/import-tidsal.mjs --dry-run
 *   node scripts-agent/import-tidsal.mjs --reset
 *   (--reset borra el catálogo antes de reimportar; sin él falla si ya hay productos)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { Client } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const STOCK_DEFAULT = Number(process.env.STOCK_DEFAULT || 999);
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 1);
const DRY = process.argv.includes('--dry-run');
const RESET = process.argv.includes('--reset');

const ADT_DIR = path.join(ROOT, 'db', 'ADD_CONTAB');
const TIPOS_JSON = path.join(ROOT, 'backend', 'data', 'JSON', 'TIPOS_PRODUCTOS.JSON');

// Sucursales TID (INSUC) -> branches.code. Datos ficticios salvo code.
const BRANCHES = [
  { code: '1', name: 'TID Sucursal 1' },
  { code: '2', name: 'TID Sucursal 2' },
  { code: '11', name: 'TID Sucursal 11' },
];

const TAX_BY_TIPO_IMP = { J: 'IVA19', C: 'IVA5', E: 'EXENTO' };

// ─────────────────────────────── lector ADT ───────────────────────────────

const BASE = 0x190;
const DESC = 200;

function readAdt(file) {
  const data = fs.readFileSync(file);
  const hdrLen = data.readUInt32LE(0x20);
  const recLen = data.readUInt32LE(0x24);
  const recCount = data.readUInt32LE(0x18);
  const map = new Map();
  const nfields = Math.floor((hdrLen - BASE) / DESC);
  for (let i = 0; i < nfields; i++) {
    const o = BASE + i * DESC;
    let end = o;
    while (end < o + 0x80 && data[end] !== 0) end++;
    const name = data.toString('latin1', o, end);
    if (!name) continue;
    map.set(name, {
      type: data[o + 0x81],
      offset: data.readUInt16LE(o + 0x83),
      length: data[o + 0x87],
    });
  }
  const rec = (i) => data.subarray(hdrLen + i * recLen, hdrLen + (i + 1) * recLen);
  const raw = (r, name) => {
    const f = map.get(name);
    if (!f) throw new Error(`campo ${name} no existe en ${path.basename(file)}`);
    return r.subarray(f.offset, f.offset + f.length);
  };
  const str = (r, name) =>
    raw(r, name).toString('latin1').replace(/[\u0000\s]+$/g, '').replace(/^[\u0000\s]+/, '');
  const num = (r, name) => {
    const f = map.get(name);
    const b = raw(r, name);
    if (f.type === 0x0a) return b.readDoubleLE(0);
    if (f.type === 0x0b) return b.readInt32LE(0);
    return NaN;
  };
  return { recCount, rec, str, num, has: (n) => map.has(n) };
}

// ─────────────────────────────── utilidades ───────────────────────────────

function slugify(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

async function insertBatches(client, table, cols, rows, suffix = '') {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const tuples = [];
    const params = [];
    for (const row of chunk) {
      tuples.push('(' + row.map((_, c) => `$${params.length + c + 1}`).join(',') + ')');
      params.push(...row);
    }
    await client.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${suffix}`,
      params,
    );
  }
}

// ─────────────────────────────── carga fuente ───────────────────────────────

console.log('⏳ Leyendo TIDSAL.adt…');
const sal = readAdt(path.join(ADT_DIR, 'TIDSAL.adt'));

/** artic -> master + Map(branch -> {v1,v0,web,activo,minimo,maximo,reorder}) */
const productsByArtic = new Map();

for (let i = 0; i < sal.recCount; i++) {
  const r = sal.rec(i);
  const artic = sal.str(r, 'INARTIC');
  if (!artic) continue;
  const branch = String(Math.round(sal.num(r, 'INSUC')));
  const web = sal.str(r, 'INWEB') === 'T';
  const activo = sal.str(r, 'INACTIVO') === 'A';
  const v1 = Math.round(sal.num(r, 'INVRVENTA1'));
  const v0 = Math.round(sal.num(r, 'INVRVENTA0'));

  let p = productsByArtic.get(artic);
  if (!p) {
    p = {
      artic,
      nombre: sal.str(r, 'INNOMBRE'),
      ean: sal.str(r, 'INEAN') || null,
      marca: sal.str(r, 'INMARCA') || null,
      marcap: sal.str(r, 'INMARCAP') || null,
      unidad: sal.str(r, 'INUNIDAD') || null,
      tipo: sal.str(r, 'INTIPO') || null,
      tipoImp: sal.str(r, 'INTIMP') || null,
      plu: (() => {
        const num = Math.round(sal.num(r, 'NUMERO'));
        return num > 0 ? String(num) : null;
      })(),
      cost: sal.num(r, 'INVRULTC') || 0,
      nombre4: sal.str(r, 'INNOMBRE4') || null,
      nombre3: sal.str(r, 'INNOMBRE3') || null,
      present: sal.str(r, 'INPRESEN') || null,
      empaque: Math.round(sal.num(r, 'INEMBALAJE')) || null,
      ean14: sal.str(r, 'INEAN14') || null,
      parte: sal.str(r, 'INPARTE') || null,
      invima: sal.str(r, 'ININVIMA') || null,
      cum: sal.str(r, 'INCUM') || null,
      ubic: sal.str(r, 'INUBIC') || null,
      largo: sal.num(r, 'INLARGO') || 0,
      ancho: sal.num(r, 'INANCHO') || 0,
      alto: sal.num(r, 'INALTO') || 0,
      proveedor: sal.str(r, 'INPROVEE') || null,
      activo: false,
      web: false,
      branches: new Map(),
    };
    productsByArtic.set(artic, p);
  }
  p.activo = p.activo || activo;
  p.web = p.web || web;
  p.branches.set(branch, {
    v1,
    v0,
    web,
    activo,
    minimo: Math.max(0, Math.round(sal.num(r, 'INMINIMO') || 0)),
    maximo: Math.max(0, Math.round(sal.num(r, 'INMAXIMO') || 0)),
    reorder: Math.max(0, Math.round(sal.num(r, 'INPTOPOS') || 0)),
  });
}

console.log(`   ${productsByArtic.size} artículos distintos`);

// EAN duplicados -> null (el esquema los exige únicos)
const eanCount = new Map();
for (const p of productsByArtic.values()) {
  if (p.ean) eanCount.set(p.ean, (eanCount.get(p.ean) ?? 0) + 1);
}
let eanDropped = 0;
for (const p of productsByArtic.values()) {
  if (p.ean && eanCount.get(p.ean) > 1) {
    p.ean = null;
    eanDropped++;
  }
}

// ─────────────────────────────── conexión ───────────────────────────────

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const url = new URL(DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) && !process.argv.includes('--allow-remote')) {
  throw new Error(`DATABASE_URL no es local (${url.hostname}); usa --allow-remote para forzar`);
}

const q = (text, params) => client.query(text, params);
const one = async (text, params) => (await client.query(text, params)).rows[0];

// ─────────────────────────────── reset ───────────────────────────────

const { productos } = await one('SELECT count(*)::int AS productos FROM products');
if (productos > 0 && !RESET && !DRY) {
  throw new Error(`Ya hay ${productos} productos. Usa --reset para borrar y reimportar.`);
}
if (RESET && !DRY) {
  console.log('🧹 Borrando catálogo previo…');
  for (const t of [
    'branch_products',
    'product_attributes',
    'product_tax_classes',
    'product_type_assignments',
    'product_categories',
    'supplier_products',
    'inventory',
    'prices',
    'product_variants',
    'products',
  ]) {
    await q(`DELETE FROM ${t}`);
  }
}

// ─────────────────────────────── sucursales ───────────────────────────────

const storeId = (await one('SELECT id FROM store ORDER BY id LIMIT 1')).id;
const branchIdByCode = new Map();
if (!DRY) {
  for (const b of BRANCHES) {
    const row = (
      await q(
        `INSERT INTO branches
           (code, name, address, city, phone, store_id, email, manager_name, manager_phone,
            branch_type, location, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          b.code,
          b.name,
          'PENDIENTE (dato ficticio)',
          'Manizales',
          '0000000',
          storeId,
          `sucursal${b.code}@pendiente.local`,
          'PENDIENTE',
          '0000000',
          'STORE',
          '0,0',
        ],
      )
    ).rows[0];
    branchIdByCode.set(b.code, Number(row.id));
  }
} else {
  for (const b of BRANCHES) {
    const row = await one('SELECT id FROM branches WHERE code = $1', [b.code]);
    branchIdByCode.set(b.code, row ? Number(row.id) : -1);
  }
}
console.log('🏬 Sucursales:', [...branchIdByCode.entries()].map(([c, id]) => `${c}=${id}`).join(', '));

// ─────────────────────────────── impuestos ───────────────────────────────

const taxRows = (await q('SELECT id, code FROM tax_rates')).rows;
const taxIdByCode = new Map(taxRows.map((t) => [t.code.trim(), Number(t.id)]));
for (const code of Object.values(TAX_BY_TIPO_IMP)) {
  if (!taxIdByCode.has(code)) throw new Error(`Falta tax_rate ${code}`);
}
const fallbackTaxId = taxIdByCode.get('IVA19');

// ─────────────────────────────── marcas ───────────────────────────────

const existingBrands = (await q('SELECT id, name FROM brands')).rows;
const brandIdByName = new Map(existingBrands.map((b) => [b.name.trim().toLowerCase(), Number(b.id)]));
const brandNames = [
  ...new Set(
    [...productsByArtic.values()].map((p) => p.marcap || p.marca).filter(Boolean),
  ),
];
let brandsCreated = 0;
if (!DRY) {
  for (const name of brandNames) {
    const key = name.trim().toLowerCase();
    if (brandIdByName.has(key)) continue;
    const slug = `${slugify(name)}-${brandIdByName.size}`.slice(0, 100);
    const row = (
      await q(
        `INSERT INTO brands (name, slug, website, description, country, is_active)
         VALUES ($1,$2,'','Importado TID','',true)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name.trim().slice(0, 100), slug],
      )
    ).rows[0];
    brandIdByName.set(key, Number(row.id));
    brandsCreated++;
  }
}
const fallbackBrandId = await (async () => {
  const key = 'sin marca';
  if (brandIdByName.has(key)) return brandIdByName.get(key);
  if (DRY) return null;
  const row = (
    await q(
      `INSERT INTO brands (name, slug, website, description, country, is_active)
       VALUES ('Sin marca','sin-marca-fallback','','Importado TID','',true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    )
  ).rows[0];
  brandIdByName.set(key, Number(row.id));
  return Number(row.id);
})();
const brandIdOf = (name) =>
  name ? brandIdByName.get(name.trim().toLowerCase()) ?? fallbackBrandId : fallbackBrandId;
/** Marca del artículo: INMARCAP (92%) con respaldo en INMARCA (3%). */
const brandNameOf = (p) => p.marcap || p.marca || null;

// ─────────────────────────────── categorías (TIDTAB) ───────────────────────────────

console.log('⏳ Leyendo TIDTAB.ADT…');
const tab = readAdt(path.join(ADT_DIR, 'TIDTAB.ADT'));
const tabName = new Map();
const tabParent = new Map();
for (let i = 0; i < tab.recCount; i++) {
  const r = tab.rec(i);
  const code = tab.str(r, 'CTABCOD');
  if (!code) continue;
  tabName.set(code, tab.str(r, 'CTABDES') || code);
  tabParent.set(code, tab.str(r, 'CTABCOD1') || null);
}

const usedCodes = new Set();
for (const p of productsByArtic.values()) {
  for (const L of [1, 3, 5, 7]) {
    if (p.artic.length >= L) usedCodes.add(p.artic.slice(0, L));
  }
}
const levelOf = (code) => ({ 1: 0, 3: 1, 5: 2, 7: 3 }[code.length] ?? 3);

if (RESET && !DRY) {
  console.log('🧹 Borrando categorías/tipos previos…');
  await q('DELETE FROM product_categories');
  await q('DELETE FROM categories');
  await q('DELETE FROM product_type_assignments');
  await q('DELETE FROM product_types');
}

const categoryIdByCode = new Map();
if (!DRY) {
  const codesByLevel = [...usedCodes].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const seenSibling = new Set();
  for (const code of codesByLevel) {
    const baseName = (tabName.get(code) || `Categoría ${code}`).slice(0, 100);
    const parentCode = tabParent.get(code) || null;
    const parentId = parentCode ? categoryIdByCode.get(parentCode) ?? null : null;
    const sibKey = `${parentId ?? 'root'}|${baseName.toLowerCase()}`;
    const name = seenSibling.has(sibKey) ? `${baseName} (${code})`.slice(0, 100) : baseName;
    seenSibling.add(sibKey);
    const slug = `${slugify(name) || 'cat'}-${code}`.slice(0, 100);
    const row = (
      await q(
        `INSERT INTO categories (parent_id, name, slug, code, level, is_active)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [parentId, name, slug, code, levelOf(code)],
      )
    ).rows[0];
    categoryIdByCode.set(code, Number(row.id));
  }
}
console.log(`🌳 Categorías: ${usedCodes.size} nodos`);

// ─────────────────────────────── tipos de producto ───────────────────────────────

const tiposRaw = JSON.parse(fs.readFileSync(TIPOS_JSON, 'utf8'));
const tiposRows = tiposRaw.TIPOS_PRODUCTOS ?? tiposRaw.CATEGORIAS ?? [];
const typeNameByCode = new Map(
  tiposRows.map((t) => [String(t.CODIGO).trim(), String(t.NOMBRE).trim()]),
);
for (const p of productsByArtic.values()) {
  if (p.tipo && !typeNameByCode.has(p.tipo)) typeNameByCode.set(p.tipo, `Tipo ${p.tipo}`);
}
const typeIdByCode = new Map();
if (!DRY) {
  for (const [code, name] of [...typeNameByCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const row = (
      await q(
        `INSERT INTO product_types (code, name, description, is_active)
         VALUES ($1,$2,'Importado TID',true)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [code.slice(0, 10), name.slice(0, 100)],
      )
    ).rows[0];
    typeIdByCode.set(code, Number(row.id));
  }
}
console.log(`🏷️  Tipos de producto: ${typeNameByCode.size}`);

// ─────────────────────────────── atributos ───────────────────────────────

const ATTR_DEFS = [
  ['Unidad de medida', 'unidad-medida', (p) => p.unidad],
  ['Presentación', 'presentacion', (p) => p.present],
  ['Nombre corto', 'nombre-corto', (p) => p.nombre3],
  ['Unidades por empaque', 'unidades-empaque', (p) => p.empaque],
  ['EAN caja (EAN-14)', 'ean-caja', (p) => p.ean14],
  ['Referencia fabricante', 'referencia-fabricante', (p) => p.parte],
  ['Registro sanitario INVIMA', 'registro-invima', (p) => p.invima],
  ['CUM', 'cum', (p) => p.cum],
  ['Ubicación bodega', 'ubicacion-bodega', (p) => p.ubic],
];
const attrIdBySlug = new Map();
if (!DRY) {
  for (const [name, slug] of ATTR_DEFS) {
    const row = (
      await q(
        `INSERT INTO attributes (name, slug, is_active) VALUES ($1,$2,true)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [name, slug],
      )
    ).rows[0];
    attrIdBySlug.set(slug, Number(row.id));
  }
}
console.log(`🪪 Atributos: ${ATTR_DEFS.length}`);

// ─────────────────────────── proveedores (CONTERCE) ───────────────────────────

console.log('⏳ Leyendo CONTERCE.adt (proveedores)…');
const ter = readAdt(path.join(ADT_DIR, 'CONTERCE.adt'));
const provCodes = new Set([...productsByArtic.values()].map((p) => p.proveedor).filter(Boolean));
const provNameByNit = new Map();
for (let i = 0; i < ter.recCount; i++) {
  const r = ter.rec(i);
  const nit = ter.str(r, 'NIT');
  if (provCodes.has(nit) && !provNameByNit.has(nit)) {
    provNameByNit.set(nit, ter.str(r, 'MNOMBRE'));
  }
}
const supplierIdByCode = new Map();
if (!DRY) {
  for (const code of provCodes) {
    const legalName = (provNameByNit.get(code) || `Proveedor ${code}`).slice(0, 200);
    const row = (
      await q(
        `INSERT INTO suppliers (code, legal_name, tax_id, is_active)
         VALUES ($1,$2,$3,true)
         ON CONFLICT (code) DO UPDATE SET legal_name = EXCLUDED.legal_name
         RETURNING id`,
        [code.slice(0, 30), legalName, code.slice(0, 50)],
      )
    ).rows[0];
    supplierIdByCode.set(code, Number(row.id));
  }
}
console.log(`🚚 Proveedores: ${provCodes.size} (con nombre: ${provNameByNit.size})`);

function buildDescription(p) {
  const base = p.nombre4 || p.nombre;
  const parts = [];
  const brand = brandNameOf(p);
  if (brand) parts.push(`Marca: ${brand}`);
  if (p.present) parts.push(`Presentación: ${p.present}`);
  if (p.empaque) parts.push(`Empaque: ${p.empaque}`);
  if (p.invima) parts.push(`Reg. INVIMA: ${p.invima}`);
  return parts.length ? `${base} · ${parts.join(' · ')}` : base;
}

// ─────────────────────────────── resumen previo ───────────────────────────────

const articulos = [...productsByArtic.values()];
let priceCount = 0;
let invCount = 0;
let bpCount = 0;
for (const p of articulos) {
  for (const [branch, d] of p.branches) {
    if (!branchIdByCode.has(branch)) continue;
    if (d.v1 > 0) priceCount++;
    invCount++;
    bpCount++;
  }
}

if (DRY) {
  console.log('\n🧪 DRY-RUN — nada se escribió. Totales a importar:');
  console.log(`   products              : ${articulos.length}`);
  console.log(`   product_variants      : ${articulos.length}`);
  console.log(`   prices (variante×suc) : ${priceCount}`);
  console.log(`   inventory             : ${invCount} (stock ${STOCK_DEFAULT})`);
  console.log(`   branch_products       : ${bpCount}`);
  console.log(`   categories            : ${usedCodes.size}`);
  console.log(`   product_types         : ${typeNameByCode.size}`);
  console.log(`   attributes            : ${ATTR_DEFS.length}`);
  console.log(`   suppliers             : ${provCodes.size}`);
  console.log(`   marcas (brands)       : ${brandNames.length}`);
  console.log(`   supplier_products     : ${articulos.filter((p) => p.proveedor).length}`);
  console.log(`   EAN duplicados -> null: ${eanDropped}`);
  await client.end();
  process.exit(0);
}

// ─────────────────────────────── productos ───────────────────────────────

console.log('⏳ Insertando productos…');
const now = new Date().toISOString();
await insertBatches(
  client,
  'products',
  ['external_id', 'brand_id', 'plu', 'name', 'slug', 'description', 'product_type', 'sku_prefix',
   'manufacturer', 'visibility', 'is_public', 'is_active', 'published_at'],
  articulos.map((p) => [
    p.artic, brandIdOf(brandNameOf(p)), p.plu, p.nombre.slice(0, 255),
    `${slugify(p.nombre) || 'producto'}-${p.artic}`.slice(0, 255),
    buildDescription(p), 'SIMPLE', p.artic.slice(0, 6),
    brandNameOf(p), 'PUBLIC', p.web, p.activo, now,
  ]),
);
const productIdByArtic = new Map(
  (await q('SELECT id, external_id FROM products')).rows.map((r) => [
    r.external_id,
    Number(r.id),
  ]),
);

// ─────────────────────────────── variantes ───────────────────────────────

console.log('⏳ Insertando variantes…');
await insertBatches(
  client,
  'product_variants',
  ['product_id', 'sku', 'barcode', 'current_price', 'current_compare_price', 'cost_price',
   'length_mm', 'width_mm', 'height_mm', 'is_active'],
  articulos.map((p) => {
    const primary = [...p.branches.keys()].sort((a, b) => Number(a) - Number(b))[0];
    const d = p.branches.get(primary);
    const compare = d.v0 > 0 && d.v0 <= d.v1 ? d.v0 : null;
    return [
      productIdByArtic.get(p.artic), p.artic, p.ean,
      String(d.v1 || 0), compare === null ? null : String(compare),
      p.cost > 0 ? p.cost.toFixed(2) : null,
      p.largo > 0 ? Math.round(p.largo * 10) : null,
      p.ancho > 0 ? Math.round(p.ancho * 10) : null,
      p.alto > 0 ? Math.round(p.alto * 10) : null,
      true,
    ];
  }),
);
const variantBySku = new Map(
  (await q('SELECT id, sku, product_id FROM product_variants')).rows.map((r) => [
    r.sku,
    { id: Number(r.id), productId: Number(r.product_id) },
  ]),
);

// ─────────────────────────────── precios ───────────────────────────────

console.log('⏳ Insertando precios…');
const priceRows = [];
const invRows = [];
const bpRows = [];
const catRows = [];
const typeRows = [];
const taxRowsAssign = [];
const attrRows = [];
const supplierRows = [];
for (const p of articulos) {
  const v = variantBySku.get(p.artic);
  const pid = productIdByArtic.get(p.artic);
  const leaf = p.artic.slice(0, 7);
  const catId = categoryIdByCode.get(leaf);
  if (catId && pid) catRows.push([pid, catId]);
  const typeId = p.tipo ? typeIdByCode.get(p.tipo) : null;
  if (typeId && pid) typeRows.push([pid, typeId]);
  const taxId = taxIdByCode.get(TAX_BY_TIPO_IMP[p.tipoImp] ?? '') ?? fallbackTaxId;
  if (taxId && pid) taxRowsAssign.push([pid, taxId, ADMIN_USER_ID]);

  if (pid) {
    for (const [name, slug, get] of ATTR_DEFS) {
      const val = get(p);
      if (val !== null && val !== undefined && val !== '') {
        attrRows.push([pid, attrIdBySlug.get(slug), String(val).slice(0, 255)]);
      }
    }
  }
  if (v && p.proveedor) {
    const sid = supplierIdByCode.get(p.proveedor);
    if (sid) {
      supplierRows.push([
        sid, v.id, p.parte || null, p.cost > 0 ? p.cost.toFixed(2) : null,
      ]);
    }
  }

  for (const [branch, d] of p.branches) {
    const bid = branchIdByCode.get(branch);
    if (!bid || bid < 0 || !v) continue;
    if (d.v1 > 0) {
      const compare = d.v0 > 0 && d.v0 <= d.v1 ? d.v0 : null;
      priceRows.push([
        v.id, bid, String(d.v1), compare === null ? null : String(compare),
        p.cost > 0 ? p.cost.toFixed(2) : null, ADMIN_USER_ID, 'Import TID',
      ]);
    }
    const maxStock = Math.max(d.maximo, d.minimo);
    invRows.push([v.id, bid, STOCK_DEFAULT, d.reorder, d.minimo, maxStock]);
    bpRows.push([bid, pid, d.web, d.activo]);
  }
}

await insertBatches(
  client,
  'prices',
  ['product_variant_id', 'branch_id', 'price', 'compare_price', 'cost', 'changed_by', 'change_reason'],
  priceRows,
);
await insertBatches(
  client,
  'inventory',
  ['product_variant_id', 'branch_id', 'stock', 'reorder_point', 'minimum_stock', 'maximum_stock'],
  invRows,
);
await insertBatches(
  client,
  'branch_products',
  ['branch_id', 'product_id', 'is_public', 'is_available'],
  bpRows,
  'ON CONFLICT (branch_id, product_id) DO NOTHING',
);
await insertBatches(client, 'product_categories', ['product_id', 'category_id'], catRows);
await insertBatches(
  client,
  'product_type_assignments',
  ['product_id', 'product_type_id'],
  typeRows,
);
await insertBatches(
  client,
  'product_tax_classes',
  ['product_id', 'tax_rate_id', 'assigned_by'],
  taxRowsAssign,
);
await insertBatches(
  client,
  'product_attributes',
  ['product_id', 'attribute_id', 'custom_value'],
  attrRows,
);
await insertBatches(
  client,
  'supplier_products',
  ['supplier_id', 'product_variant_id', 'supplier_sku', 'purchase_price'],
  supplierRows,
  'ON CONFLICT (supplier_id, product_variant_id) DO NOTHING',
);

// Marcas huérfanas (sin productos) creadas por imports previos: se descartan
// para que solo queden las marcas asociadas a productos.
if (RESET) {
  const del = await q(
    `DELETE FROM brands
     WHERE name <> 'Sin marca'
       AND id NOT IN (SELECT brand_id FROM products WHERE brand_id IS NOT NULL)`,
  );
  console.log(`🧹 Marcas huérfanas eliminadas: ${del.rowCount}`);
}

// ─────────────────────────────── resumen ───────────────────────────────

const counts = await one(
  `SELECT (SELECT count(*)::int FROM products) products,
          (SELECT count(*)::int FROM product_variants) variants,
          (SELECT count(*)::int FROM prices) prices,
          (SELECT count(*)::int FROM inventory) inventory,
          (SELECT count(*)::int FROM branch_products) branch_products,
          (SELECT count(*)::int FROM categories) categories,
          (SELECT count(*)::int FROM product_types) product_types,
          (SELECT count(*)::int FROM product_attributes) product_attributes,
          (SELECT count(*)::int FROM suppliers) suppliers,
          (SELECT count(*)::int FROM supplier_products) supplier_products`,
);
console.log('\n✅ Import terminado');
console.log(counts);
console.log(`   marcas nuevas: ${brandsCreated}, EAN duplicados->null: ${eanDropped}`);

await client.end();
