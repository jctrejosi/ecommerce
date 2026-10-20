#!/usr/bin/env node
/**
 * Detecta imágenes duplicadas por contenido (MD5) en `db/images_static`.
 *
 * Optimiza agrupando primero por tamaño: solo hashea archivos cuyo tamaño
 * coincide con otro. Imprime un resumen (no vuelca listados completos).
 *
 * Uso:
 *   node scripts-agent/find-duplicate-images.mjs
 *   node scripts-agent/find-duplicate-images.mjs --json db/duplicate_images.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ROOTS = [path.join(ROOT, 'db', 'images_static')];
const IMAGE_EXT = new Set(['.jpeg', '.jpg', '.png', '.webp', '.gif', '.bmp', '.tiff']);

const jsonIdx = process.argv.indexOf('--json');
const JSON_OUT = jsonIdx !== -1 ? process.argv[jsonIdx + 1] : null;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

function hashFile(p) {
  const h = crypto.createHash('md5');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

const files = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const p of walk(root)) files.push({ p, size: fs.statSync(p).size });
}

const bySize = new Map();
for (const f of files) {
  if (!bySize.has(f.size)) bySize.set(f.size, []);
  bySize.get(f.size).push(f);
}

const byHash = new Map();
let hashed = 0;
for (const [, group] of bySize) {
  if (group.length < 2) continue;
  for (const f of group) {
    const h = hashFile(f.p);
    hashed++;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(f);
  }
}

const dupGroups = [...byHash.entries()].filter(([, g]) => g.length > 1);

const rel = (p) => path.relative(ROOT, p);
const groupsJson = dupGroups
  .map(([hash, g]) => ({
    hash,
    size: g[0].size,
    count: g.length,
    files: g.map((f) => rel(f.p)).sort(),
  }))
  .sort((a, b) => b.count - a.count || b.size - a.size);

const duplicateFiles = groupsJson.reduce((acc, g) => acc + g.count, 0);
const wasted = groupsJson.reduce((acc, g) => acc + g.size * (g.count - 1), 0);
const crossFolder = groupsJson.filter((g) => {
  const roots = new Set(g.files.map((f) => (f.includes('images_products') ? 'products' : 'static')));
  return roots.size > 1;
});

console.log(`Archivos de imagen escaneados: ${files.length}`);
console.log(`Hasheados (tamaño repetido):   ${hashed}`);
console.log(`Grupos duplicados:             ${groupsJson.length}`);
console.log(`Archivos en grupos duplicados: ${duplicateFiles}`);
console.log(`Duplicados sobrantes:          ${duplicateFiles - groupsJson.length}`);
console.log(`Espacio recuperable:           ${(wasted / 1024 / 1024).toFixed(1)} MB`);
console.log(`Grupos que cruzan carpetas:    ${crossFolder.length}`);

console.log('\nTop grupos:');
for (const g of groupsJson.slice(0, 5)) {
  console.log(`- ${g.count}x ${(g.size / 1024).toFixed(0)} KB`);
  for (const f of g.files.slice(0, 4)) console.log(`    ${f}`);
  if (g.files.length > 4) console.log(`    … y ${g.files.length - 4} más`);
}

if (JSON_OUT) {
  const abs = path.resolve(ROOT, JSON_OUT);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        scanned_files: files.length,
        duplicate_groups: groupsJson.length,
        duplicate_files: duplicateFiles,
        wasted_bytes: wasted,
        groups: groupsJson,
      },
      null,
      2,
    ),
  );
  console.log(`\nDetalle escrito en: ${JSON_OUT}`);
}
