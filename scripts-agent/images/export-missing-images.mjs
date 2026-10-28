/**
 * Exporta a JSON los productos ACTIVOS del ecommerce que no tienen imagen.
 *
 * Destino: /home/jk/Proyectos/seeds/Vassago/web_scraper/scanner/products_without_image.json
 * (es el directorio del scanner que buscará las imágenes en mercaldas.com).
 *
 * Sólo lee la DB. Uso:
 *   node scripts-agent/images/export-missing-images.mjs
 *   node scripts-agent/images/export-missing-images.mjs --out=/ruta/otro.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from '../erp/openads.mjs';
import { args, ROOT, log } from '../erp/lib.mjs';

const OUT =
  args().out ||
  '/home/jk/Proyectos/seeds/Vassago/web_scraper/scanner/products_without_image.json';
const BASE_URL = 'https://www.mercaldas.com';
const SEARCH_ENDPOINT = '/api/catalog_system/pub/products/search';

const pg = createPg();
await pg.connect();

// ── Árbol de categorías (para el path legible) ────────────────
const cats = (
  await pg.query(
    `SELECT id, parent_id, name, level, code FROM categories
      WHERE deleted_at IS NULL AND code ~ '^V[0-9]+$'`,
  )
).rows;
const catById = new Map(cats.map((c) => [Number(c.id), c]));
const pathOf = (id) => {
  const names = [];
  let cur = catById.get(Number(id));
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parent_id ? catById.get(Number(cur.parent_id)) : null;
  }
  return names.join(' > ');
};

// ── Productos activos sin imagen ──────────────────────────────
const rows = (
  await pg.query(`
    SELECT p.id,
           p.name,
           p.plu,
           p.is_public,
           b.name AS brand,
           COALESCE(array_agg(DISTINCT NULLIF(btrim(pv.sku), '')) FILTER (WHERE pv.sku IS NOT NULL), '{}') AS skus,
           COALESCE(array_agg(DISTINCT NULLIF(btrim(pv.barcode), '')) FILTER (WHERE pv.barcode IS NOT NULL), '{}') AS barcodes,
           COALESCE(array_agg(DISTINCT pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cat_ids
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN product_categories pc ON pc.product_id = p.id
     WHERE p.is_active AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_images pi
           JOIN media m ON m.id = pi.media_id
          WHERE pi.product_id = p.id AND m.path IS NOT NULL
       )
     GROUP BY p.id, p.name, p.plu, p.is_public, b.name
  `)
).rows;

// ── Archivos locales que sí existirían (los 120 rescatables) ──
const mediaDir = path.join(ROOT, 'db/images_static/media/products');
const flatDir = path.join(ROOT, 'db/images_static/products');
const flatFiles = new Set(
  fs.readdirSync(flatDir).map((f) => path.basename(f, path.extname(f)).toUpperCase()),
);
const localFileFor = (id, barcodes, skus, plu) => {
  const dir = path.join(mediaDir, String(id));
  if (fs.existsSync(dir)) {
    const f = fs.readdirSync(dir).find((x) => /\.(jpe?g|png|webp)$/i.test(x));
    if (f) return path.join('db/images_static/media/products', String(id), f);
  }
  for (const key of [...barcodes, ...skus, plu]) {
    const k = String(key ?? '').toUpperCase();
    if (k && flatFiles.has(k)) {
      const f = fs
        .readdirSync(flatDir)
        .find((x) => path.basename(x, path.extname(x)).toUpperCase() === k);
      if (f) return path.join('db/images_static/products', f);
    }
  }
  return null;
};

const products = rows.map((r) => {
  const barcodes = (r.barcodes ?? []).map(String);
  const skus = (r.skus ?? []).map(String);
  const catIds = (r.cat_ids ?? []).map(Number);
  const paths = catIds
    .map((id) => pathOf(id))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const q = new URLSearchParams({ ft: r.name }).toString();
  return {
    product_id: Number(r.id),
    name: r.name,
    plu: r.plu ? String(r.plu).trim() : null,
    skus,
    barcodes,
    brand: r.brand ?? null,
    is_public: !!r.is_public,
    category_path: paths[0] ?? null,
    category_paths: [...new Set(paths)],
    search_url: `${BASE_URL}${SEARCH_ENDPOINT}?${q}`,
    ean_search_url: barcodes.length
      ? `${BASE_URL}${SEARCH_ENDPOINT}?fq=alternateIds_Ean:${encodeURIComponent(barcodes[0])}`
      : null,
    local_file: localFileFor(r.id, barcodes, skus, r.plu),
  };
});

products.sort((a, b) =>
  (a.category_path ?? '~').localeCompare(b.category_path ?? '~', 'es') ||
  a.name.localeCompare(b.name, 'es'),
);

const conLocal = products.filter((p) => p.local_file).length;

const payload = {
  generated_at: new Date().toISOString(),
  source: 'postgres ecommerce · products.is_active = true sin filas en product_images',
  total: products.length,
  con_archivo_local: conLocal,
  nota:
    'Cada entrada incluye search_url (búsqueda VTEX por nombre) y ean_search_url ' +
    '(búsqueda por EAN). local_file apunta a un archivo que existe en disco pero no ' +
    'está vinculado en product_images.',
  products,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

log(`✅ ${products.length} productos sin imagen → ${OUT}`);
log(`   con archivo local disponible: ${conLocal}`);
log(`   tamaño: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);

await pg.end();
