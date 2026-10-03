#!/usr/bin/env node
/**
 * Exporta TODO el catálogo de la BD a `db/products.json` (sólo lectura).
 *
 * Incluye por producto: códigos (id, external_id, PLU, SKU, barcode), nombre,
 * descripción, marca, fabricante, categoría, tipo, precios, costo, dimensiones,
 * estado, fecha de creación, imagen principal (ruta local) y stock total/por
 * sucursal.
 *
 * Uso: node scripts-agent/export-products.mjs
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
const OUT_FILE = path.join(ROOT, 'db', 'products.json');

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const rows = (
  await client.query(`
    SELECT p.id,
           p.external_id,
           p.plu,
           p.name,
           p.description,
           p.manufacturer,
           p.is_active,
           p.is_public,
           p.featured,
           p.created_at::date AS created,
           b.name  AS brand,
           v.sku,
           v.barcode,
           v.current_price,
           v.current_compare_price,
           v.cost_price,
           v.length_mm,
           v.width_mm,
           v.height_mm,
           (SELECT c.name
              FROM product_categories pc
              JOIN categories c ON c.id = pc.category_id
             WHERE pc.product_id = p.id
             LIMIT 1) AS category,
           (SELECT t.code
              FROM product_type_assignments pta
              JOIN product_types t ON t.id = pta.product_type_id
             WHERE pta.product_id = p.id
             LIMIT 1) AS type_code,
           (SELECT t.name
              FROM product_type_assignments pta
              JOIN product_types t ON t.id = pta.product_type_id
             WHERE pta.product_id = p.id
             LIMIT 1) AS type_name,
           (SELECT m.path
              FROM product_images pi
              JOIN media m ON m.id = pi.media_id
             WHERE pi.product_id = p.id AND pi.is_cover = true
             LIMIT 1) AS image,
           (SELECT count(*)::int
              FROM product_images pi
             WHERE pi.product_id = p.id) AS images_count
      FROM products p
      LEFT JOIN product_variants v
             ON v.product_id = p.id AND v.deleted_at IS NULL
      LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.deleted_at IS NULL
     ORDER BY p.name, p.id
  `)
).rows;

const stockRows = (
  await client.query(`
    SELECT v.product_id, br.code AS branch, COALESCE(SUM(i.stock), 0)::int AS stock
      FROM inventory i
      JOIN product_variants v ON v.id = i.product_variant_id
      JOIN branches br ON br.id = i.branch_id
     GROUP BY v.product_id, br.code
  `)
).rows;

const stockByProduct = new Map();
for (const r of stockRows) {
  const current = stockByProduct.get(String(r.product_id)) ?? {};
  current[r.branch] = r.stock;
  stockByProduct.set(String(r.product_id), current);
}

const num = (v) => (v == null ? null : Number(v));

const products = rows.map((r) => {
  const image = r.image ?? null;
  const stockByBranch = stockByProduct.get(String(r.id)) ?? {};
  return {
    id: Number(r.id),
    external_id: r.external_id,
    plu: r.plu,
    sku: r.sku,
    barcode: r.barcode,
    name: r.name,
    description: r.description,
    brand: r.brand,
    manufacturer: r.manufacturer,
    category: r.category,
    product_type_code: r.type_code,
    product_type_name: r.type_name,
    price: num(r.current_price),
    compare_price: num(r.current_compare_price),
    cost_price: num(r.cost_price),
    dimensions_mm:
      r.length_mm || r.width_mm || r.height_mm
        ? { length: r.length_mm, width: r.width_mm, height: r.height_mm }
        : null,
    is_active: r.is_active,
    is_public: r.is_public,
    featured: r.featured,
    created: r.created,
    image,
    image_origin: image
      ? image.startsWith('/static/products/')
        ? 'zip'
        : image.startsWith('/static/media/')
          ? 'media-local'
          : 'external'
      : null,
    images_count: r.images_count,
    stock_total: Object.values(stockByBranch).reduce((a, b) => a + b, 0),
    stock_by_branch: stockByBranch,
  };
});

const withImage = products.filter((p) => p.image).length;

const payload = {
  generated_at: new Date().toISOString(),
  source: 'postgresql ecommerce',
  total_products: products.length,
  with_image: withImage,
  without_image: products.length - withImage,
  products,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
console.log(`Productos: ${products.length}`);
console.log(`  con imagen   : ${withImage}`);
console.log(`  sin imagen   : ${products.length - withImage}`);
console.log(
  `JSON: ${path.relative(ROOT, OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB)`,
);

await client.end();
