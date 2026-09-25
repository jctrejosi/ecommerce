#!/usr/bin/env node
/**
 * Valida las imágenes en Cloudinary (carpeta products/) contra los productos
 * de la BD local, cruzando por el código de `public_id` (`prod_<externalId>`).
 *
 * Uso: node scripts-agent/.scratch/cloudinary-check.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { v2: cloudinary } = require('cloudinary');
const { Client } = require('pg');

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url));
dotenv.config({ path: path.join(backendDir, '.env.development.local') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

async function listAll() {
  const out = [];
  let cursor;
  for (let page = 0; page < 50; page++) {
    const res = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'products/',
      max_results: 500,
      next_cursor: cursor,
    });
    out.push(...res.resources.map((r) => r.public_id));
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  return out;
}

const ids = await listAll();
console.log(`Cloudinary products/: ${ids.length} assets`);
console.log('  ejemplos:', ids.slice(0, 5));

const byCode = new Map(); // code -> public_id
const byPlu = new Map(); // plu  -> public_id
for (const id of ids) {
  const parts = id.split('/');
  if (parts[0] !== 'products' || parts.length < 3) continue;
  const plu = parts[1];
  const rest = parts.slice(2).join('/');
  const code = rest.startsWith('prod_') ? rest.slice(5) : rest;
  if (code && !byCode.has(code)) byCode.set(code, id);
  if (plu && !byPlu.has(plu)) byPlu.set(plu, id);
}
console.log(`  códigos únicos: ${byCode.size}   plu únicos: ${byPlu.size}`);

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  'SELECT external_id, plu FROM products WHERE external_id IS NOT NULL',
);
const extIds = new Set(rows.map((r) => String(r.external_id)));
const plus = new Set(rows.map((r) => (r.plu == null ? '' : String(r.plu))).filter(Boolean));

let matchCode = 0;
for (const c of byCode.keys()) if (extIds.has(c)) matchCode++;
let matchPlu = 0;
for (const p of byPlu.keys()) if (plus.has(p)) matchPlu++;

console.log(`productos en BD: ${rows.length}`);
console.log(`match por código (external_id): ${matchCode}/${byCode.size}`);
console.log(`match por carpeta PLU        : ${matchPlu}/${byPlu.size}`);
console.log('  ejemplos plu Cloudinary:', [...byPlu.keys()].slice(0, 8));
console.log('  ejemplos plu BD        :', [...plus].slice(0, 8));

await client.end();
