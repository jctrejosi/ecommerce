#!/usr/bin/env node
/**
 * Re-vincula las imágenes ya existentes en Cloudinary (carpeta `products/`) a
 * los productos de la BD, creando/actualizando `media` y `product_images`.
 *
 * Cruza por el código del `public_id` (`prod_<external_id>`), con respaldo por
 * la carpeta PLU. Guarda la referencia/etiqueta de Cloudinary en media.metadata.
 *
 * Uso:
 *   node scripts-agent/relink-product-images.mjs --dry-run
 *   node scripts-agent/relink-product-images.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { v2: cloudinary } = require('cloudinary');
const { Client } = require('pg');

const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));
dotenv.config({ path: path.join(backendDir, '.env.development.local') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const DRY = process.argv.includes('--dry-run');
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

async function listAssets() {
  const out = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const res = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'image',
      prefix: 'products/',
      max_results: 500,
      next_cursor: cursor,
    });
    out.push(...res.resources);
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  return out;
}

const assets = await listAssets();
console.log(`Cloudinary products/: ${assets.length} imágenes`);

// código (external_id) -> asset, y plu -> asset
const byCode = new Map();
const byPlu = new Map();
for (const a of assets) {
  const parts = String(a.public_id).split('/');
  if (parts[0] !== 'products' || parts.length < 3) continue;
  const plu = parts[1];
  const rest = parts.slice(2).join('/');
  const code = rest.startsWith('prod_') ? rest.slice(5) : rest;
  if (code && !byCode.has(code)) byCode.set(code, a);
  if (plu && !byPlu.has(plu)) byPlu.set(plu, a);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const products = (
  await client.query(
    'SELECT id, external_id, plu FROM products WHERE external_id IS NOT NULL AND deleted_at IS NULL',
  )
).rows;

let linked = 0;
let created = 0;
let skipped = 0;
const unmatched = [];

for (const p of products) {
  const code = String(p.external_id);
  const asset = byCode.get(code) ?? (p.plu ? byPlu.get(String(p.plu)) : undefined);
  if (!asset) continue;

  const publicId = asset.public_id;
  const folder = publicId.split('/').slice(0, 2).join('/'); // products/<plu>
  const checksum = `cloudinary:${publicId}`.slice(0, 64);
  const mime = `image/${asset.format || 'jpeg'}`;
  const metadata = {
    source: 'cloudinary',
    public_id: publicId,
    folder,
    plu: p.plu ? String(p.plu) : null,
    tag: 'products',
  };

  if (DRY) {
    linked++;
    continue;
  }

  // Reutiliza el media existente (misma URL) para no duplicar.
  const existingMedia = await client.query(
    'SELECT id FROM media WHERE path = $1 OR checksum = $2 LIMIT 1',
    [asset.secure_url, checksum],
  );
  let mediaId;
  if (existingMedia.rowCount > 0) {
    mediaId = existingMedia.rows[0].id;
    await client.query(
      `UPDATE media SET width = $2, height = $3, metadata = $4::jsonb,
         provider = 'cloudinary', updated_at = now() WHERE id = $1`,
      [
        mediaId,
        asset.width ?? null,
        asset.height ?? null,
        JSON.stringify(metadata),
      ],
    );
  } else {
    mediaId = (
      await client.query(
        `INSERT INTO media
           (status, media_type, provider, path, file_name, mime_type, size_bytes,
            width, height, checksum, metadata, is_public)
         VALUES ('active','image','cloudinary',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,true)
         RETURNING id`,
        [
          asset.secure_url,
          `prod_${code}`.slice(0, 255),
          mime,
          asset.bytes ?? 0,
          asset.width ?? null,
          asset.height ?? null,
          checksum,
          JSON.stringify(metadata),
        ],
      )
    ).rows[0].id;
  }

  const ins = await client.query(
    `INSERT INTO product_images (product_id, media_id, is_cover, position)
     SELECT $1, $2, true, 0
     WHERE NOT EXISTS (
       SELECT 1 FROM product_images WHERE product_id = $1 AND is_cover = true
     )`,
    [p.id, mediaId],
  );
  if (ins.rowCount > 0) created++;
  else skipped++;
  linked++;
}

for (const code of byCode.keys()) {
  if (!products.some((p) => String(p.external_id) === code)) unmatched.push(code);
}

console.log(`${DRY ? '[DRY-RUN] ' : ''}imágenes vinculadas: ${linked}`);
console.log(`  portadas creadas : ${created}`);
console.log(`  ya tenían portada: ${skipped}`);
console.log(`  sin producto en BD: ${unmatched.length} (ej: ${unmatched.slice(0, 5).join(', ')})`);

await client.end();
