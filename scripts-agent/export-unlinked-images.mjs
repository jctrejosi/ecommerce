#!/usr/bin/env node
/**
 * Exporta a `db/images_products_unlinked.json` la metadata de las fotos de
 * `db/images_products/` que no están asociadas a ningún producto (no tienen
 * fila en `media`). Sólo lectura + escritura del JSON.
 *
 * Uso: node scripts-agent/export-unlinked-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { Client } = require('pg');
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, 'backend', '.env.development.local') });

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const IMG_DIR = path.join(ROOT, 'db', 'images_products');
const OUT_FILE = path.join(ROOT, 'db', 'images_products_unlinked.json');
const MIME = /\.(jpe?g|png|webp|gif)$/i;

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
const linked = new Set(
  (
    await client.query(`SELECT checksum FROM media WHERE checksum LIKE 'local:tid:%'`)
  ).rows.map((r) => r.checksum.slice('local:tid:'.length)),
);
await client.end();

const all = fs.readdirSync(IMG_DIR).filter((f) => MIME.test(f));
const unlinked = all.filter((f) => !linked.has(f)).sort();

console.log(`Fotos totales: ${all.length}`);
console.log(`Asociadas    : ${all.length - unlinked.length}`);
console.log(`Sin asociar  : ${unlinked.length}`);

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

const images = [];
await pool(unlinked, 16, async (file) => {
  const full = path.join(IMG_DIR, file);
  const stat = fs.statSync(full);
  let width = null;
  let height = null;
  let format = path.extname(file).slice(1).toLowerCase();
  try {
    const meta = await sharp(full).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
    format = meta.format ?? format;
  } catch {}
  images.push({
    file,
    code: file.replace(/\.[^.]+$/, ''),
    code_length: file.replace(/\.[^.]+$/, '').length,
    size_bytes: stat.size,
    width,
    height,
    format,
    modified: stat.mtime.toISOString().slice(0, 10),
  });
});
images.sort((a, b) => a.file.localeCompare(b.file));

const payload = {
  generated_at: new Date().toISOString(),
  source_dir: 'db/images_products',
  total_images: all.length,
  linked_images: all.length - unlinked.length,
  unlinked_images: unlinked.length,
  note: 'Fotos cuyo código (EAN/PLU/alternos) no existe en el catálogo importado; quedan en disco sin asociar.',
  images,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
console.log(`\nJSON escrito: ${path.relative(ROOT, OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB)`);
