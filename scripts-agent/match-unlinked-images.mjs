#!/usr/bin/env node
/**
 * Segunda pasada de enlace de fotos: para las fotos de `db/images_products/`
 * que quedaron sin producto, busca su código en TODOS los identificadores del
 * TID crudo (db/ADD_CONTAB/TIDSAL.adt): INEAN, INEANC (alterno), INEAN14
 * (caja), NUMERO (PLU), INARTIC, INARTICES (referencia cruzada).
 *
 * Sólo asigna imagen a productos que HOY no tienen portada (no pisa nada).
 * Idempotente. Dry-run por defecto.
 *
 * Uso:
 *   node scripts-agent/match-unlinked-images.mjs
 *   node scripts-agent/match-unlinked-images.mjs --apply
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
const backendDir = path.join(ROOT, 'backend', '');
dotenv.config({ path: path.join(backendDir, '.env.development.local') });

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const IMG_DIR = path.join(ROOT, 'db', 'images_products');
const ADT = path.join(ROOT, 'db', 'ADD_CONTAB', 'TIDSAL.adt');

const APPLY = process.argv.includes('--apply');
const BATCH = 250;

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const stem = (f) => f.replace(/\.[^.]+$/, '');
const norm = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '');

// ── lector ADT (mismo formato que import-tidsal.mjs) ────────────────────────
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
    raw(r, name)
      .toString('latin1')
      .replace(/[\u0000\s]+$/g, '')
      .replace(/^[\u0000\s]+/, '');
  const num = (r, name) => {
    const f = map.get(name);
    const b = raw(r, name);
    if (f.type === 0x0a) return b.readDoubleLE(0);
    if (f.type === 0x0b) return b.readInt32LE(0);
    return NaN;
  };
  return { recCount, rec, str, num, has: (n) => map.has(n) };
}

console.log('⏳ Leyendo TIDSAL.adt…');
const sal = readAdt(ADT);
const has14 = sal.has('INEAN14');
const hasC = sal.has('INEANC');
const hasEs = sal.has('INARTICES');

// artic -> { codes: {tipo: Set(valor)} }
const byArtic = new Map();
const put = (artic, tipo, value) => {
  const v = String(value ?? '').trim();
  if (!v) return;
  let rec = byArtic.get(artic);
  if (!rec) rec = byArtic.set(artic, {}).get(artic);
  (rec[tipo] ??= new Set()).add(v);
};

for (let i = 0; i < sal.recCount; i++) {
  const r = sal.rec(i);
  const artic = sal.str(r, 'INARTIC');
  if (!artic) continue;
  put(artic, 'ean', sal.str(r, 'INEAN'));
  put(artic, 'artic', artic);
  if (hasC) put(artic, 'eanc', sal.str(r, 'INEANC'));
  if (has14) put(artic, 'ean14', sal.str(r, 'INEAN14'));
  if (hasEs) put(artic, 'artices', sal.str(r, 'INARTICES'));
  const numero = Math.round(sal.num(r, 'NUMERO'));
  if (numero > 0) put(artic, 'plu', String(numero));
}
console.log(`Artículos TID: ${byArtic.size}`);

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const rows = (
  await client.query(
    `SELECT p.id, p.external_id,
            EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id AND pi.is_cover = true) AS has_cover
       FROM products p WHERE p.deleted_at IS NULL`,
  )
).rows;
const articToProduct = new Map();
const rowById = new Map();
for (const r of rows) {
  rowById.set(r.id, r);
  if (r.external_id) articToProduct.set(String(r.external_id), r.id);
}

// Mapas código -> artic (exacto y normalizado)
const maps = { ean: new Map(), eanc: new Map(), ean14: new Map(), ean14s: new Map(), plu: new Map(), artic: new Map(), artices: new Map() };
const addMap = (map, value, artic, { variants = [] } = {}) => {
  const keys = new Set([String(value).trim(), norm(value), ...variants.map((v) => String(v).trim())]);
  for (const k of keys) if (k && !map.has(k)) map.set(k, artic);
};
for (const [artic, codes] of byArtic) {
  for (const [tipo, set] of Object.entries(codes)) {
    for (const value of set) {
      if (tipo === 'ean14') {
        // El EAN de caja suele venir con dígito de empaque: tolerar sin el primero.
        addMap(maps.ean14, value, artic, { variants: [value.slice(1), value.slice(0, 13)] });
      } else {
        addMap(maps[tipo], value, artic);
      }
    }
  }
}

// Fotos ya enlazadas (media con checksum local:tid:)
const linkedRes = await client.query(
  `SELECT checksum FROM media WHERE checksum LIKE 'local:tid:%'`,
);
const linked = new Set(linkedRes.rows.map((r) => r.checksum.slice('local:tid:'.length)));

const files = fs
  .readdirSync(IMG_DIR)
  .filter((f) => MIME[path.extname(f).toLowerCase()]);
const pending = files.filter((f) => !linked.has(f));
console.log(`Fotos sin enlace: ${pending.length}`);

const stats = { nuevos: 0, sinProducto: 0, sinPortada: 0, yaTienePortada: 0, porTipo: {}, largos: {} };
const willLink = new Map(); // file -> productId
const sample = [];

for (const file of pending) {
  const s = stem(file);
  stats.largos[s.length] = (stats.largos[s.length] ?? 0) + 1;

  let artic = null;
  let tipo = null;
  const lookup = [
    ['ean', maps.ean, [norm(s)]],
    ['eanc', maps.eanc, [norm(s)]],
    ['ean14', maps.ean14, [norm(s)]],
    ['plu', maps.plu, [norm(s)]],
    ['artices', maps.artices, [norm(s)]],
  ];
  for (const [name, map, variants] of lookup) {
    artic = map.get(s) ?? variants.map((v) => map.get(v)).find(Boolean);
    if (artic) {
      tipo = name;
      break;
    }
  }
  if (!artic) {
    stats.sinProducto++;
    if (sample.length < 10) sample.push(file);
    continue;
  }

  const productId = articToProduct.get(String(artic));
  if (!productId) {
    stats.sinProducto++;
    if (sample.length < 10) sample.push(file);
    continue;
  }

  const row = rowById.get(productId);
  if (row?.has_cover) {
    stats.yaTienePortada++;
    continue;
  }

  stats.nuevos++;
  stats.porTipo[tipo] = (stats.porTipo[tipo] ?? 0) + 1;
  if (!willLink.has(file)) willLink.set(file, productId);
}

console.log(`\nResultado (${APPLY ? 'aplicando' : 'dry-run'}):`);
console.log(`  fotos que enlazan a producto sin portada : ${stats.nuevos}`);
console.log(
  `  por tipo de código                        : ${Object.entries(stats.porTipo)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ') || '—'}`,
);
console.log(`  foto de producto que ya tiene portada    : ${stats.yaTienePortada} (se omite)`);
console.log(`  sin producto en BD                       : ${stats.sinProducto}`);
console.log(
  `  longitudes de nombre                     : ${Object.entries(stats.largos)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')}`,
);
if (sample.length) console.log(`  ejemplos sin match                       : ${sample.join(', ')}`);

if (!APPLY) {
  await client.end();
  process.exit(0);
}

// ── aplicar ────────────────────────────────────────────────────────────────
let done = 0;
let pendingTx = 0;
await client.query('BEGIN');
for (const [file, productId] of willLink) {
  const filePath = path.join(IMG_DIR, file);
  const stat = fs.statSync(filePath);
  const checksum = `local:tid:${file}`.slice(0, 64);

  let mediaId = (
    await client.query('SELECT id FROM media WHERE checksum = $1 LIMIT 1', [checksum])
  ).rows[0]?.id;

  if (!mediaId) {
    let width = null;
    let height = null;
    try {
      const meta = await sharp(filePath).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {}
    mediaId = (
      await client.query(
        `INSERT INTO media
           (status, media_type, provider, path, file_name, mime_type, size_bytes,
            width, height, checksum, metadata, is_public)
         VALUES ('active','image','local',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,true)
         RETURNING id`,
        [
          `/static/products/${file}`,
          file,
          MIME[path.extname(file).toLowerCase()],
          stat.size,
          width,
          height,
          checksum,
          JSON.stringify({ source: 'tid-jpg2', file, match: 'extended' }),
        ],
      )
    ).rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO product_images (product_id, media_id, is_cover, position)
     SELECT $1, $2, true, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM product_images WHERE product_id = $1 AND is_cover = true
      )`,
    [productId, mediaId],
  );
  done += inserted.rowCount;

  if (++pendingTx >= BATCH) {
    await client.query('COMMIT');
    await client.query('BEGIN');
    pendingTx = 0;
  }
}
await client.query('COMMIT');

console.log(`\nAplicado: ${done} portadas nuevas.`);
await client.end();
