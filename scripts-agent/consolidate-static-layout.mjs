#!/usr/bin/env node
/**
 * Consolida TODOS los estáticos en un único directorio: `db/images_static/`.
 *
 * Estructura final (las URLs públicas NO cambian):
 *
 *   db/images_static/
 *     products/                  -> /static/products/...      (fotos TID planas)
 *     products/_sin_producto/    -> /static/products/_sin_producto/... (sin asociar)
 *     media/                     -> /static/media/...
 *       products/                -> /static/media/products/...  (subidas del ecommerce)
 *       brands/ delivery/ picking/ inventory/ redsolidaria/ samples/ uploads/ ...
 *
 * Movimientos:
 *   - db/images_static/<subdir>        -> db/images_static/media/<subdir>
 *   - db/images_static/products/<dir>  -> db/images_static/media/products/<dir>
 *     (las subidas por id; en el primer pase se mueve `products` completo)
 *   - db/images_products/<archivo>     -> db/images_static/products/<archivo>
 *   - db/images_products/_sin_producto -> db/images_static/products/_sin_producto
 *   - db/images_products/Ean.bat       -> db/Ean.bat (no es un estático)
 *
 * Dry-run por defecto. Idempotente.
 *
 * Uso:
 *   node scripts-agent/consolidate-static-layout.mjs
 *   node scripts-agent/consolidate-static-layout.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const STATIC_DIR = path.join(ROOT, 'db', 'images_static');
const MEDIA_DIR = path.join(STATIC_DIR, 'media');
const PRODUCTS_DIR = path.join(STATIC_DIR, 'products');
const OLD_PRODUCTS_DIR = path.join(ROOT, 'db', 'images_products');
const BAT_FILE = 'Ean.bat';

const APPLY = process.argv.includes('--apply');

const moves = []; // { from, to }

function plan() {
  if (!fs.existsSync(STATIC_DIR)) throw new Error(`No existe ${STATIC_DIR}`);

  const firstPass = !fs.existsSync(MEDIA_DIR);

  for (const entry of fs.readdirSync(STATIC_DIR, { withFileTypes: true })) {
    if (entry.name === 'media') continue;

    if (entry.name === 'products') {
      if (firstPass) {
        // Primer pase: todo `products` es media subida por id.
        moves.push({ from: PRODUCTS_DIR, to: path.join(MEDIA_DIR, 'products') });
      } else {
        // Pases posteriores: sólo los subdirectorios (las fotos TID planas se quedan).
        for (const sub of fs.readdirSync(PRODUCTS_DIR, { withFileTypes: true })) {
          if (!sub.isDirectory() || sub.name === '_sin_producto') continue;
          moves.push({
            from: path.join(PRODUCTS_DIR, sub.name),
            to: path.join(MEDIA_DIR, 'products', sub.name),
          });
        }
      }
      continue;
    }

    moves.push({ from: path.join(STATIC_DIR, entry.name), to: path.join(MEDIA_DIR, entry.name) });
  }

  // Fotos TID (directorio legado)
  if (fs.existsSync(OLD_PRODUCTS_DIR)) {
    for (const entry of fs.readdirSync(OLD_PRODUCTS_DIR, { withFileTypes: true })) {
      if (entry.name === '_sin_producto') continue;
      const from = path.join(OLD_PRODUCTS_DIR, entry.name);
      const to =
        entry.name === BAT_FILE
          ? path.join(ROOT, 'db', BAT_FILE)
          : path.join(PRODUCTS_DIR, entry.name);
      moves.push({ from, to });
    }

    const unlinked = path.join(OLD_PRODUCTS_DIR, '_sin_producto');
    if (fs.existsSync(unlinked)) {
      moves.push({ from: unlinked, to: path.join(PRODUCTS_DIR, '_sin_producto') });
    }
  }
}

function apply() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  let done = 0;
  let failed = 0;

  for (const { from, to } of moves) {
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) {
      console.warn(`SKIP (destino existe): ${path.relative(ROOT, from)} -> ${path.relative(ROOT, to)}`);
      failed++;
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    done++;
  }

  if (fs.existsSync(OLD_PRODUCTS_DIR)) {
    const rest = fs.readdirSync(OLD_PRODUCTS_DIR);
    if (rest.length === 0) fs.rmdirSync(OLD_PRODUCTS_DIR);
    else console.log(`images_products/ no quedó vacío: ${rest.join(', ')}`);
  }

  console.log(`Movidos: ${done} | Omitidos: ${failed}`);
}

plan();

console.log(`Destino único: ${path.relative(ROOT, STATIC_DIR)}`);
console.log(`Elementos a mover: ${moves.length}`);
for (const { from, to } of moves.slice(0, 8)) {
  console.log(`  ${path.relative(ROOT, from)} -> ${path.relative(ROOT, to)}`);
}
if (moves.length > 8) console.log(`  … y ${moves.length - 8} más`);

const collisions = moves.filter(({ from, to }) => fs.existsSync(from) && fs.existsSync(to));
if (collisions.length) {
  console.log(`\nColisiones detectadas: ${collisions.length}`);
  for (const c of collisions.slice(0, 10)) {
    console.log(`  ${path.relative(ROOT, c.from)} -> ${path.relative(ROOT, c.to)}`);
  }
}

if (!APPLY) {
  console.log('\nDry-run. Ejecuta con --apply para mover.');
} else {
  console.log('');
  apply();
}
