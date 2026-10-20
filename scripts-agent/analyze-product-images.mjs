#!/usr/bin/env node
/**
 * Analiza la cobertura de las imágenes de `db/images_products/` contra el
 * catálogo de la BD. NO modifica nada: sólo mide y reporta un resumen.
 *
 * Cruces por nombre de archivo (sin extensión) contra:
 *   - product_variants.sku
 *   - product_variants.barcode
 *   - products.plu
 *   - products.external_id
 * y un segundo pase normalizando ceros a la izquierda.
 *
 * Uso: node scripts-agent/analyze-product-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { Client } = require('pg');

const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));
dotenv.config({ path: path.join(backendDir, '.env.development.local') });

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const IMG_DIR = fileURLToPath(new URL('../db/images_static/products/', import.meta.url));

const files = fs
  .readdirSync(IMG_DIR)
  .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
const stem = (f) => f.replace(/\.[^.]+$/, '');
const norm = (s) => String(s ?? '').replace(/^0+(?=\d)/, '');

console.log(`Archivos de imagen: ${files.length}`);

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const rows = (
  await client.query(`
    SELECT p.id, p.plu, p.external_id, v.sku, v.barcode,
           EXISTS (
             SELECT 1 FROM product_images pi
             WHERE pi.product_id = p.id AND pi.is_cover = true
           ) AS has_cover
    FROM products p
    JOIN product_variants v ON v.product_id = p.id
    WHERE p.deleted_at IS NULL
  `)
).rows;

console.log(`Productos con variante en BD: ${rows.length}`);

// Mapas clave -> fila (el primer producto gana)
const mkMap = (get) => {
  const m = new Map();
  for (const r of rows) {
    const k = norm(get(r));
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
};
const bySku = mkMap((r) => r.sku);
const byBarcode = mkMap((r) => r.barcode);
const byPlu = mkMap((r) => r.plu);
const byExt = mkMap((r) => r.external_id);

const keys = [
  ['sku', bySku],
  ['barcode', byBarcode],
  ['plu', byPlu],
  ['external_id', byExt],
];

let exact = 0;
let normalizedOnly = 0;
const unmatched = [];
const matchedProducts = new Map(); // product id -> {file, via, exact}
const usedFiles = new Set();

for (const f of files) {
  const s = stem(f);
  let hit = null;
  let via = null;
  let isExact = false;
  for (const [name, m] of keys) {
    if (m.has(s)) {
      hit = m.get(s);
      via = name;
      isExact = true;
      break;
    }
  }
  if (!hit) {
    const n = norm(s);
    for (const [name, m] of keys) {
      if (m.has(n)) {
        hit = m.get(n);
        via = `${name} (norm)`;
        break;
      }
    }
  }
  if (!hit) {
    unmatched.push(f);
    continue;
  }
  if (isExact) exact++;
  else normalizedOnly++;
  usedFiles.add(f);
  if (!matchedProducts.has(hit.id)) {
    matchedProducts.set(hit.id, { file: f, via, hasCover: hit.has_cover });
  }
}

const matchedWithCover = [...matchedProducts.values()].filter((v) => v.hasCover).length;
const matchedWithoutCover = matchedProducts.size - matchedWithCover;
const coverNoMatch = rows.filter((r) => r.has_cover && !matchedProducts.has(r.id)).length;
const totalCovers = rows.filter((r) => r.has_cover).length;

console.log(`\n— Cruce archivos —`);
console.log(`  con match exacto          : ${exact}`);
console.log(`  con match normalizado     : ${normalizedOnly}`);
console.log(`  SIN match                 : ${unmatched.length}`);
console.log(`  ejemplos sin match        : ${unmatched.slice(0, 8).join(', ')}`);

const viaCount = {};
for (const v of matchedProducts.values()) viaCount[v.via] = (viaCount[v.via] ?? 0) + 1;
console.log(
  `  matches por clave         : ${Object.entries(viaCount)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')}`,
);

console.log(`\n— Cobertura productos —`);
console.log(`  productos con imagen zip  : ${matchedProducts.size} / ${rows.length}`);
console.log(`  portadas actuales         : ${totalCovers}`);
console.log(`    de esas, con zip        : ${matchedWithCover} (podrían reemplazarse)`);
console.log(`    de esas, sin zip        : ${coverNoMatch} (quedarían como están)`);
console.log(`  productos sin portada     : ${rows.length - totalCovers}`);
console.log(`    que ganarían portada    : ${matchedWithoutCover}`);

// Productos sin barcode (dato de calidad)
const sinBarcode = rows.filter((r) => !r.barcode).length;
console.log(`  productos sin barcode     : ${sinBarcode}`);

await client.end();
