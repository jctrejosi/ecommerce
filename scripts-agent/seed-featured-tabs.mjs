#!/usr/bin/env node
/**
 * Siembra las pestañas destacadas (featured_product_tabs) con productos que
 * TIENEN imagen:
 *   - Los más vendidos -> MAS_VENDIDOS_0.JSON (orden de ventas)
 *   - Promociones      -> productos con precio comparativo (comparar != null)
 *   - Recomendados     -> DESTACADOS_0.JSON
 *   - Novedades        -> últimos productos con imagen
 *
 * Uso:
 *   node scripts-agent/seed-featured-tabs.mjs --dry-run
 *   node scripts-agent/seed-featured-tabs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { Client } = require('pg');

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
dotenv.config({ path: path.join(ROOT, 'backend', '.env.development.local') });

const DRY = process.argv.includes('--dry-run');
const PER_TAB = Number(process.env.PER_TAB || 24);
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

function loadCodes(file, key) {
  const p = path.join(ROOT, 'backend', 'data', file);
  if (!fs.existsSync(p)) return [];
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'))[key] ?? [];
  return rows
    .sort((a, b) => Number(a.ORDEN) - Number(b.ORDEN))
    .map((r) => String(r.CODIGO).trim())
    .filter(Boolean);
}

const masVendidosCodes = loadCodes('MAS_VENDIDOS_0.JSON', 'MAS_VENDIDOS');
const destacadosCodes = loadCodes('DESTACADOS_0.JSON', 'DESTACADOS');

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const tabs = (
  await client.query(
    'SELECT id, slug FROM featured_product_tabs WHERE slug = ANY($1)',
    [['mas-vendidos', 'promociones', 'recomendados', 'novedades']],
  )
).rows;
const tabIdBySlug = new Map(tabs.map((t) => [t.slug, Number(t.id)]));

// Candidatos: productos activos con variante activa y portada (imagen).
const candidates = (
  await client.query(
    `SELECT p.id, p.external_id, v.current_compare_price
       FROM products p
       JOIN product_variants v
         ON v.product_id = p.id AND v.is_active = true AND v.deleted_at IS NULL
       JOIN product_images pi
         ON pi.product_id = p.id AND pi.is_cover = true
      WHERE p.is_active = true AND p.deleted_at IS NULL
      ORDER BY p.id`,
  )
).rows;

const byExt = new Map(candidates.map((r) => [String(r.external_id), r]));
const allIds = candidates.map((r) => Number(r.id));
console.log(`candidatos con imagen: ${allIds.length}`);
const masMatch = masVendidosCodes.filter((c) => byExt.has(c)).length;
const destMatch = destacadosCodes.filter((c) => byExt.has(c)).length;
console.log(
  `cruzan con imagen -> más vendidos: ${masMatch}/${masVendidosCodes.length}, destacados: ${destMatch}/${destacadosCodes.length}`,
);

function pick(codes, n) {
  const out = [];
  const seen = new Set();
  for (const code of codes) {
    const row = byExt.get(code);
    if (row && !seen.has(Number(row.id))) {
      seen.add(Number(row.id));
      out.push(Number(row.id));
      if (out.length >= n) return out;
    }
  }
  for (const id of allIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
      if (out.length >= n) break;
    }
  }
  return out;
}

const onSale = candidates
  .filter((r) => r.current_compare_price !== null)
  .map((r) => Number(r.id));
const novedades = [...allIds].reverse().slice(0, PER_TAB);

const plan = {
  'mas-vendidos': pick(masVendidosCodes, PER_TAB),
  promociones: (onSale.length >= 8 ? onSale : pick([], PER_TAB)).slice(0, PER_TAB),
  recomendados: pick(destacadosCodes, PER_TAB),
  novedades,
};

for (const [slug, ids] of Object.entries(plan)) {
  const tabId = tabIdBySlug.get(slug);
  console.log(
    `${DRY ? '[DRY] ' : ''}${slug.padEnd(14)} tab=${tabId ?? 'N/A'} -> ${ids.length} productos`,
  );
  if (DRY || !tabId) continue;

  await client.query('DELETE FROM featured_product_assignments WHERE tab_id = $1', [tabId]);
  for (let i = 0; i < ids.length; i++) {
    await client.query(
      `INSERT INTO featured_product_assignments (tab_id, product_id, position, is_active)
       VALUES ($1, $2, $3, true)`,
      [tabId, ids[i], i],
    );
  }
}

if (!DRY) {
  const counts = await client.query(
    `SELECT t.slug, count(a.id) n
       FROM featured_product_tabs t
       LEFT JOIN featured_product_assignments a
         ON a.tab_id = t.id AND a.is_active = true
      GROUP BY t.slug ORDER BY t.slug`,
  );
  console.table(counts.rows);
}

await client.end();
