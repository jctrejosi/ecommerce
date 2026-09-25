#!/usr/bin/env node
/** Descubre en Cloudinary las imágenes de tipos de producto. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { v2: cloudinary } = require('cloudinary');

dotenv.config({ path: path.join(fileURLToPath(new URL('../../backend/', import.meta.url)), '.env.development.local') });
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function listAll() {
  const out = [];
  let cursor;
  for (let p = 0; p < 100; p++) {
    const res = await cloudinary.api.resources({
      type: 'upload',
      max_results: 500,
      next_cursor: cursor,
    });
    out.push(...res.resources);
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  return out;
}

const assets = await listAll();
console.log(`assets totales: ${assets.length}`);

const folders = new Map();
for (const a of assets) {
  const seg = String(a.public_id).split('/');
  const top = seg.length > 1 ? seg[0] : '(root)';
  folders.set(top, (folders.get(top) ?? 0) + 1);
}
console.log('carpetas raíz:', [...folders.entries()].sort((a, b) => b[1] - a[1]));

const KEYS = /BEBE|BEBÉ|CARNES|CUIDADO|VERDURA|FRUTA|HOGAR|LIMPIEZA|MASCOTA|LACTEO|DESPENSA|VINOS|TECNO|ELECTRO|TIPO|TYPE/i;
const hits = assets.filter((a) => KEYS.test(a.public_id) && !String(a.public_id).startsWith('products/'));
console.log(`\ncandidatos a tipo (fuera de products/): ${hits.length}`);
for (const a of hits.slice(0, 40)) {
  console.log(`  ${a.public_id}  ->  ${a.secure_url}`);
}
