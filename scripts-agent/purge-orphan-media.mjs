#!/usr/bin/env node
/**
 * Elimina de `db/images_static/` los archivos que ninguna referencia de la BD
 * usa (media.path, delivery_drivers.avatar_url, settings.value->url).
 *
 * NO toca `products/_sin_producto/`: esas fotos se conservan a propósito para
 * asignarlas manualmente más adelante.
 *
 * Dry-run por defecto.
 *
 * Uso:
 *   node scripts-agent/purge-orphan-media.mjs
 *   node scripts-agent/purge-orphan-media.mjs --apply
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
const STATIC_DIR = path.join(ROOT, 'db', 'images_static');
const KEEP_DIR = path.join('products', '_sin_producto');

const APPLY = process.argv.includes('--apply');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const urlFor = (abs) =>
  '/static/' + path.relative(STATIC_DIR, abs).split(path.sep).join('/');

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const media = await client.query(`select path from media where path like '/static/%'`);
  const drivers = await client.query(
    `select avatar_url from delivery_drivers where avatar_url like '/static/%'`,
  );
  const settings = await client.query(
    `select value->>'url' u from settings where value->>'url' like '/static/%'`,
  );
  await client.end();

  const referenced = new Set([
    ...media.rows.map((r) => r.path),
    ...drivers.rows.map((r) => r.avatar_url),
    ...settings.rows.map((r) => r.u),
  ]);

  const orphans = walk(STATIC_DIR).filter((p) => {
    const rel = path.relative(STATIC_DIR, p);
    if (rel.startsWith(KEEP_DIR.split(path.sep).join(path.sep) + path.sep)) return false;
    return !referenced.has(urlFor(p));
  });

  const bytes = orphans.reduce((acc, p) => acc + fs.statSync(p).size, 0);
  const byFolder = {};
  for (const p of orphans) {
    const key = path.relative(STATIC_DIR, p).split(path.sep).slice(0, 2).join('/');
    byFolder[key] = (byFolder[key] || 0) + 1;
  }

  console.log(`Archivos en images_static: ${walk(STATIC_DIR).length}`);
  console.log(`Huérfanos:                 ${orphans.length} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  for (const [k, v] of Object.entries(byFolder).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  if (!APPLY) {
    console.log('\nDry-run. Ejecuta con --apply para eliminar.');
    return;
  }

  let deleted = 0;
  for (const p of orphans) {
    fs.unlinkSync(p);
    deleted++;
  }

  // Eliminar directorios vacíos (sin tocar la raíz ni _sin_producto)
  const prune = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (p === path.join(STATIC_DIR, KEEP_DIR)) continue;
      prune(p);
      if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    }
  };
  prune(STATIC_DIR);

  console.log(`\nEliminados: ${deleted}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
