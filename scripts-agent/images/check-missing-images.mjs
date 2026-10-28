/**
 * Diagnóstico: de los productos ACTIVOS sin imagen, ¿cuántos tienen ya un
 * archivo en `db/images_static/products/` (nombre = código de barras)?
 *
 * Sólo lee. No escribe en la DB ni mueve archivos.
 *
 * Uso: node scripts-agent/images/check-missing-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from '../erp/openads.mjs';
import { ROOT, log } from '../erp/lib.mjs';

const DIR = path.join(ROOT, 'db/images_static/products');

const files = new Set(
  fs
    .readdirSync(DIR)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => path.basename(f, path.extname(f)).toUpperCase()),
);

const pg = createPg();
await pg.connect();

const rows = (
  await pg.query(`
    SELECT p.id,
           p.name,
           array_remove(array_agg(DISTINCT NULLIF(btrim(pv.barcode), '')), NULL) AS barcodes,
           array_remove(array_agg(DISTINCT NULLIF(btrim(pv.sku), '')), NULL) AS skus
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id
     WHERE p.is_active AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_images pi
           JOIN media m ON m.id = pi.media_id
          WHERE pi.product_id = p.id AND m.path IS NOT NULL
       )
     GROUP BY p.id, p.name
  `)
).rows;

const conArchivo = [];
const sinArchivo = [];

for (const r of rows) {
  const hit = (r.barcodes ?? []).find((b) => files.has(String(b).toUpperCase()));
  const hitSku = (r.skus ?? []).find((s) => files.has(String(s).toUpperCase()));
  if (hit || hitSku) {
    conArchivo.push({ id: Number(r.id), name: r.name, key: hit ?? hitSku });
  } else {
    sinArchivo.push({ id: Number(r.id), name: r.name });
  }
}

log(`Activos sin imagen en DB : ${rows.length}`);
log(`  con archivo en disco   : ${conArchivo.length}`);
log(`  sin archivo tampoco    : ${sinArchivo.length}`);
log(`Archivos en ${path.relative(ROOT, DIR)}: ${files.size}`);
log('\nMuestra con archivo disponible:');
for (const r of conArchivo.slice(0, 10)) log(`  ${r.key}  ${r.name}`);
log('\nMuestra sin archivo:');
for (const r of sinArchivo.slice(0, 10)) log(`  ${r.id}  ${r.name}`);

await pg.end();
