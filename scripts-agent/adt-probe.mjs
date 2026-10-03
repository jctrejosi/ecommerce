#!/usr/bin/env node
/**
 * Busca los códigos de las fotos SIN enlazar en TODOS los campos string de
 * archivos Advantage (.adt). Sirve para descartar que el código viva en un
 * campo raro (MODI*, INARTICES, etc.) o en otro catálogo (CATALOGO2.adt).
 *
 * Uso: node scripts-agent/adt-probe.mjs db/ADD_CONTAB/TIDSAL.adt db/ADD_CONTAB/CATALOGO2.adt
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
const MIME = /\.(jpe?g|png|webp|gif)$/i;

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Uso: node scripts-agent/adt-probe.mjs <archivo.adt> [...]');
  process.exit(1);
}

const BASE = 0x190;
const DESC = 200;
function readAdt(file) {
  const data = fs.readFileSync(file);
  const hdrLen = data.readUInt32LE(0x20);
  const recLen = data.readUInt32LE(0x24);
  const recCount = data.readUInt32LE(0x18);
  const fields = [];
  const nfields = Math.floor((hdrLen - BASE) / DESC);
  for (let i = 0; i < nfields; i++) {
    const o = BASE + i * DESC;
    let end = o;
    while (end < o + 0x80 && data[end] !== 0) end++;
    const name = data.toString('latin1', o, end);
    if (!name) continue;
    fields.push({
      name,
      type: data[o + 0x81],
      offset: data.readUInt16LE(o + 0x83),
      length: data[o + 0x87],
    });
  }
  const rec = (i) => data.subarray(hdrLen + i * recLen, hdrLen + (i + 1) * recLen);
  return { recCount, rec, fields, recLen };
}

const stem = (f) => f.replace(/\.[^.]+$/, '');
const norm = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '');

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
const linked = new Set(
  (
    await client.query(`SELECT checksum FROM media WHERE checksum LIKE 'local:tid:%'`)
  ).rows.map((r) => r.checksum.slice('local:tid:'.length)),
);
await client.end();

const unmatched = fs
  .readdirSync(IMG_DIR)
  .filter((f) => MIME.test(f) && !linked.has(f));
const wanted = new Set();
for (const f of unmatched) {
  wanted.add(stem(f));
  wanted.add(norm(stem(f)));
}
console.log(`Fotos sin enlace: ${unmatched.length} (${wanted.size} claves a buscar)`);

for (const file of files) {
  const adt = readAdt(file);
  console.log(`\n== ${path.basename(file)}: ${adt.recCount} registros, ${adt.fields.length} campos ==`);
  const hitsPerField = new Map();
  const samples = [];
  let recordsHit = 0;

  for (let i = 0; i < adt.recCount; i++) {
    const r = adt.rec(i);
    let hitThis = false;
    for (const f of adt.fields) {
      if (f.length > 24) continue; // códigos: campos cortos
      const raw = r.subarray(f.offset, f.offset + f.length).toString('latin1');
      const value = raw.replace(/[\u0000\s]+$/g, '').replace(/^[\u0000\s]+/, '');
      if (!value) continue;
      if (wanted.has(value) || wanted.has(norm(value))) {
        hitsPerField.set(f.name, (hitsPerField.get(f.name) ?? 0) + 1);
        hitThis = true;
        if (samples.length < 6) samples.push(`${value} → ${f.name}`);
      }
    }
    if (hitThis) recordsHit++;
  }

  console.log(`  registros con algún código de foto: ${recordsHit}`);
  if (hitsPerField.size) {
    console.log(
      `  campos: ${[...hitsPerField.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`,
    );
    console.log(`  ejemplos: ${samples.join(' | ')}`);
  }
}
