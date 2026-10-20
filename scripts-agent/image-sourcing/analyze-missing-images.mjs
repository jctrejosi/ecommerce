#!/usr/bin/env node
/**
 * Diagnóstico (solo lectura) para el plan de imágenes desde internet.
 *
 * Resume `db/products_without_image.json` (cobertura de códigos, marcas,
 * categorías), cruza sus identificadores contra las fotos sin enlazar de
 * `db/images_products_unlinked.json` (¿hay alguna que sirva sin salir a
 * internet?) y verifica el formato de las imágenes ya montadas desde
 * `db/products.json`.
 *
 * Imprime solo un resumen compacto; no vuelca filas al chat.
 *
 * Uso:
 *   node scripts-agent/image-sourcing/analyze-missing-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dbFile = (f) => path.join(ROOT, 'db', f);
const load = (f) => JSON.parse(fs.readFileSync(dbFile(f), 'utf8'));

const norm = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '');
const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;

console.log('Leyendo JSONs (10–22 MB, puede tardar unos segundos)...');
const missing = load('products_without_image.json');
const unlinked = load('images_products_unlinked.json');
const all = load('products.json');

const P = missing.products;
const total = P.length;

// ── 1. Cobertura de identificadores en faltantes ────────────────────────────
const usableBarcode = (b) => b && /^\d+$/.test(b) && b.length >= 8 && b.length <= 14;
const lenBuckets = {};
let withBarcode = 0;
let barcodeEqPlu = 0;
let barcodeEqSku = 0;
let barcodeEqExternal = 0;
let noBrand = 0;
let active = 0;
let publico = 0;

const byCategory = new Map();
const byType = new Map();
const byBrand = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

for (const p of P) {
  const b = p.barcode ? String(p.barcode).trim() : null;
  if (b && /^\d+$/.test(b)) {
    lenBuckets[b.length] = (lenBuckets[b.length] ?? 0) + 1;
    if (usableBarcode(b)) withBarcode++;
    if (b === norm(p.plu)) barcodeEqPlu++;
    if (b === norm(p.sku)) barcodeEqSku++;
    if (b === norm(p.external_id)) barcodeEqExternal++;
  }
  if (!p.brand) noBrand++;
  if (p.is_active) active++;
  if (p.is_public) publico++;
  bump(byCategory, p.category ?? '(sin categoría)');
  bump(byType, p.product_type_name ?? '(sin tipo)');
  bump(byBrand, p.brand ?? '(sin marca)');
}

const top = (m, n) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `    ${String(v).padStart(5)}  ${k}`)
    .join('\n');

console.log('\n== Productos sin imagen ==');
console.log(`total: ${total}  ·  activos: ${active} (${pct(active, total)})  ·  públicos: ${publico}`);
console.log(`con barcode usable (8–14 dígitos): ${withBarcode} (${pct(withBarcode, total)})`);
console.log(`  barcode == plu: ${barcodeEqPlu}  ·  == sku: ${barcodeEqSku}  ·  == external_id: ${barcodeEqExternal}`);
console.log(`longitudes de barcode: ${JSON.stringify(lenBuckets)}`);
console.log(`sin marca: ${noBrand} (${pct(noBrand, total)})`);
console.log('top categorías:');
console.log(top(byCategory, 12));
console.log('top tipos de producto:');
console.log(top(byType, 12));
console.log('top marcas:');
console.log(top(byBrand, 12));

// ── 2. Cruce con fotos sin enlazar ──────────────────────────────────────────
// ¿Alguna foto de db/images_products/ aún sin asociar corresponde a un
// producto que sí está en la lista de faltantes? (evita salir a internet)
const stems = new Set();
for (const img of unlinked.images) stems.add(norm(img.code));

const cruzadas = [];
for (const p of P) {
  const ids = [p.barcode, p.sku, p.external_id, p.plu]
    .filter(Boolean)
    .map((x) => String(x).trim());
  const hit = ids.find((id) => stems.has(norm(id)));
  if (hit) cruzadas.push({ product_id: p.id, code: hit, name: p.name });
}

console.log('\n== Cruce con fotos locales sin enlazar ==');
console.log(`fotos sin enlazar disponibles: ${unlinked.unlinked_images}`);
console.log(`productos faltantes que YA tienen foto en disco: ${cruzadas.length}`);
for (const c of cruzadas.slice(0, 8)) {
  console.log(`    #${c.product_id}  ${c.code}  ${c.name.slice(0, 48)}`);
}
if (cruzadas.length > 8) console.log(`    ... y ${cruzadas.length - 8} más`);

// ¿Y contra CUALQUIER producto del catálogo (aunque ya tenga foto)?
let matchAny = 0;
let matchAnyWithImage = 0;
for (const p of all.products) {
  const ids = [p.barcode, p.sku, p.external_id, p.plu]
    .filter(Boolean)
    .map((x) => String(x).trim());
  if (ids.some((id) => stems.has(norm(id)))) {
    matchAny++;
    if (p.image) matchAnyWithImage++;
  }
}
console.log(
  `fotos sin enlazar que coinciden con ALGÚN producto del catálogo: ${matchAny}` +
    ` (de esos, con foto ya montada: ${matchAnyWithImage})`,
);

// ── 3. Formato de las imágenes ya montadas ──────────────────────────────────
const A = all.products.filter((p) => p.image);
const origins = new Map();
const exts = new Map();
let stemIsBarcode = 0;
for (const p of A) {
  bump(origins, p.image_origin ?? '(null)');
  const m = /\.([A-Za-z0-9]+)$/.exec(p.image);
  bump(exts, m ? m[1] : '(sin ext)');
  const stem = path.basename(p.image).replace(/\.[^.]+$/, '');
  if (p.barcode && String(p.barcode).trim() === stem) stemIsBarcode++;
}

console.log('\n== Imágenes montadas (formato) ==');
console.log(`con imagen: ${A.length} (origen: ${JSON.stringify(Object.fromEntries(origins))})`);
console.log(`extensiones: ${JSON.stringify(Object.fromEntries(exts))}`);
console.log(`nombre de archivo == barcode: ${stemIsBarcode} (${pct(stemIsBarcode, A.length)})`);
const otherStems = A.filter((p) => {
  const stem = path.basename(p.image).replace(/\.[^.]+$/, '');
  return !(p.barcode && String(p.barcode).trim() === stem);
});
console.log('muestra de nombres que NO son barcode:');
for (const p of otherStems.slice(0, 8)) console.log(`    ${path.basename(p.image)}  (${p.name.slice(0, 40)})`);

console.log('\n(listo)');
