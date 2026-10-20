#!/usr/bin/env node
/**
 * Importa las fotos locales de `db/images_products/` (JPG2.zip) al catálogo:
 * cruza el nombre del archivo (sin extensión) contra barcode / sku /
 * external_id / plu y, para cada producto encontrado:
 *
 *   - crea (o reutiliza) un `media` local con `path = /static/products/<archivo>`
 *   - deja esa foto como imagen principal del producto (is_cover = true)
 *   - si el producto ya tenía portada, la anterior se conserva como secundaria
 *
 * Es idempotente: volver a correrlo no duplica media ni product_images.
 *
 * Uso:
 *   node scripts-agent/import-tid-images.mjs --dry-run
 *   node scripts-agent/import-tid-images.mjs
 *   node scripts-agent/import-tid-images.mjs --limit=500   # prueba corta
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { Client } = require('pg');
const sharp = require('sharp');

const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));
dotenv.config({ path: path.join(backendDir, '.env.development.local') });

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const IMG_DIR = fileURLToPath(new URL('../db/images_static/products/', import.meta.url));

const DRY = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 0;
const BATCH = 250;

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const stem = (f) => f.replace(/\.[^.]+$/, '');
const norm = (s) => String(s ?? '').replace(/^0+(?=\d)/, '');

let files = fs
  .readdirSync(IMG_DIR)
  .filter((f) => MIME[path.extname(f).toLowerCase()]);
if (LIMIT > 0) files = files.slice(0, LIMIT);
console.log(`Fotos a procesar: ${files.length}${DRY ? ' (dry-run)' : ''}`);

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const products = (
  await client.query(
    `SELECT p.id, p.plu, p.external_id, v.sku, v.barcode
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
      WHERE p.deleted_at IS NULL`,
  )
).rows;

// clave normalizada -> ids de producto
const add = (map, key, id) => {
  const k = norm(key);
  if (!k) return;
  const arr = map.get(k);
  if (arr) arr.push(id);
  else map.set(k, [id]);
};
const byBarcode = new Map();
const bySku = new Map();
const byExternal = new Map();
const byPlu = new Map();
for (const p of products) {
  add(byBarcode, p.barcode, p.id);
  add(bySku, p.sku, p.id);
  add(byExternal, p.external_id, p.id);
  add(byPlu, p.plu, p.id);
}

function findMatches(fileStem) {
  const s = norm(fileStem);
  for (const [source, map] of [
    ['barcode', byBarcode],
    ['sku', bySku],
    ['external_id', byExternal],
    ['plu', byPlu],
  ]) {
    const ids = map.get(s);
    if (ids?.length) {
      return { ids: [...new Set(ids)], source };
    }
  }
  return null;
}

const stats = {
  mediaCreados: 0,
  mediaReutilizados: 0,
  portadasNuevas: 0,
  portadasReemplazadas: 0,
  sinMatch: 0,
  porFuente: {},
};
const unmatched = [];
let pending = 0;

async function flushProgress() {
  if (DRY) return;
  await client.query('COMMIT');
  await client.query('BEGIN');
  pending = 0;
}

if (!DRY) await client.query('BEGIN');

for (const file of files) {
  const match = findMatches(stem(file));
  if (!match) {
    stats.sinMatch++;
    if (unmatched.length < 10) unmatched.push(file);
    continue;
  }

  stats.porFuente[match.source] = (stats.porFuente[match.source] ?? 0) + 1;

  const filePath = path.join(IMG_DIR, file);
  const stat = fs.statSync(filePath);
  const checksum = `local:tid:${file}`.slice(0, 64);
  const mediaPath = `/static/products/${file}`;

  const existing = await client.query(
    'SELECT id FROM media WHERE checksum = $1 LIMIT 1',
    [checksum],
  );

  if (DRY) {
    if (existing.rowCount > 0) stats.mediaReutilizados++;
    else stats.mediaCreados++;
    stats.portadasNuevas += match.ids.length;
    continue;
  }

  let mediaId;
  if (existing.rowCount > 0) {
    mediaId = existing.rows[0].id;
    stats.mediaReutilizados++;
  } else {
    let width = null;
    let height = null;
    try {
      const meta = await sharp(filePath).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // sin dimensiones: la imagen queda igualmente registrada
    }

    mediaId = (
      await client.query(
        `INSERT INTO media
           (status, media_type, provider, path, file_name, mime_type, size_bytes,
            width, height, checksum, metadata, is_public)
         VALUES ('active','image','local',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,true)
         RETURNING id`,
        [
          mediaPath,
          file,
          MIME[path.extname(file).toLowerCase()],
          stat.size,
          width,
          height,
          checksum,
          JSON.stringify({ source: 'tid-jpg2', file, match: match.source }),
        ],
      )
    ).rows[0].id;
    stats.mediaCreados++;
  }

  for (const productId of match.ids) {
    // La portada anterior pasa a ser secundaria.
    const demoted = await client.query(
      `UPDATE product_images SET is_cover = false, position = GREATEST(position, 1)
        WHERE product_id = $1 AND is_cover = true AND media_id <> $2`,
      [productId, mediaId],
    );
    stats.portadasReemplazadas += demoted.rowCount;

    const inserted = await client.query(
      `INSERT INTO product_images (product_id, media_id, is_cover, position)
       SELECT $1, $2, true, 0
        WHERE NOT EXISTS (
          SELECT 1 FROM product_images WHERE product_id = $1 AND media_id = $2
        )`,
      [productId, mediaId],
    );
    stats.portadasNuevas += inserted.rowCount;
  }

  pending++;
  if (pending >= BATCH) await flushProgress();
}

if (!DRY) {
  await client.query('COMMIT');
}

console.log(`\nResultado${DRY ? ' (dry-run)' : ''}:`);
console.log(`  media creados        : ${stats.mediaCreados}`);
console.log(`  media reutilizados   : ${stats.mediaReutilizados}`);
console.log(`  portadas asignadas   : ${stats.portadasNuevas}`);
console.log(`  portadas reemplazadas: ${stats.portadasReemplazadas}`);
console.log(
  `  matches por fuente   : ${Object.entries(stats.porFuente)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')}`,
);
console.log(`  sin match            : ${stats.sinMatch}`);
if (unmatched.length) console.log(`  ejemplos sin match   : ${unmatched.join(', ')}`);

await client.end();
