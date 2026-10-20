#!/usr/bin/env node
/**
 * Mueve las imágenes de `db/images_products/` que no están asociadas a ningún
 * producto a `db/images_products/_sin_producto/`.
 *
 * Criterio de "asociada": el archivo está referenciado por alguna fila de
 * `media` con ruta `/static/products/<archivo>`. Esas rutas son las que usa
 * `product_images` (y, en general, cualquier contenido del ecommerce), así que
 * mover un archivo referenciado rompería la BD.
 *
 * No se tocan archivos que no sean imágenes (p. ej. `Ean.bat`).
 *
 * Dry-run por defecto. Idempotente: si el archivo ya está en el destino, se
 * omite.
 *
 * Uso:
 *   node scripts-agent/move-unlinked-images.mjs
 *   node scripts-agent/move-unlinked-images.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { Client } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, 'backend', '.env.development.local') });

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const IMG_DIR = path.join(ROOT, 'db', 'images_products');
const DEST_DIR = path.join(IMG_DIR, '_sin_producto');

const APPLY = process.argv.includes('--apply');

const IMAGE_EXT = new Set(['.jpeg', '.jpg', '.png', '.webp', '.gif', '.bmp', '.tiff']);

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(
    `select distinct path from media where path like '/static/products/%'`,
  );
  await client.end();

  const linked = new Set(rows.map((r) => path.posix.basename(r.path)));

  const entries = fs.readdirSync(IMG_DIR, { withFileTypes: true });
  const candidates = [];
  const skippedNonImage = [];

  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      skippedNonImage.push(e.name);
      continue;
    }
    if (!linked.has(e.name)) candidates.push(e.name);
  }

  candidates.sort();

  console.log(`Referenciadas en media: ${linked.size}`);
  console.log(`Imágenes en raíz:       ${entries.filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())).length}`);
  console.log(`Sin producto (mover):   ${candidates.length}`);
  console.log(`No-imagen (omitidas):   ${skippedNonImage.length}${skippedNonImage.length ? ' -> ' + skippedNonImage.join(', ') : ''}`);
  console.log(`Destino:                ${path.relative(ROOT, DEST_DIR)}`);

  if (!APPLY) {
    if (candidates.length) console.log(`Muestra: ${candidates.slice(0, 5).join(', ')}`);
    console.log('\nDry-run. Ejecuta con --apply para mover.');
    return;
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });
  let moved = 0;
  let already = 0;

  for (const name of candidates) {
    const src = path.join(IMG_DIR, name);
    const dst = path.join(DEST_DIR, name);
    if (fs.existsSync(dst)) {
      already++;
      continue;
    }
    fs.renameSync(src, dst);
    moved++;
  }

  console.log(`\nMovidas: ${moved} | Ya estaban en destino: ${already}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
