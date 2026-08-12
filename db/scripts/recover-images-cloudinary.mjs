#!/usr/bin/env node
/**
 * Verifica en Cloudinary (patrón de los scripts: products/<plu>/prod_<external_id>)
 * qué productos actuales tienen imagen, y las asocia en la BD destino.
 *
 * Uso:
 *   TARGET_DATABASE_URL='...' node recover-images-cloudinary.mjs
 *   TARGET_DB_SSL=1  (Supabase)
 *   DRY_RUN=1        (solo reporta)
 *   CONCURRENCY=N    (default 15)
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require(
  "/home/jk/Projects/dsi/mercaldas-ecommerce/backend/node_modules/pg",
);

const TARGET_URL = process.env.TARGET_DATABASE_URL || "";
const TARGET_SSL = process.env.TARGET_DB_SSL === "1";
const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Math.min(parseInt(process.env.CONCURRENCY || "15", 10), 40);

const CLOUD = "https://res.cloudinary.com/yz7xzppt/image/upload";

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function connect(url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

// Pool de workers: procesa items con N concurrentes
async function mapPool(items, worker, n) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return results;
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 200) return res.url; // URL final (con versión)
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!TARGET_URL) fail("Define TARGET_DATABASE_URL");
  console.log("━━━ Recuperación de imágenes desde Cloudinary ━━━");

  const dst = await connect(TARGET_URL, TARGET_SSL ? { rejectUnauthorized: false } : false);
  console.log(`Destino: ${dst.connectionParameters.database}${DRY_RUN ? " (DRY RUN)" : ""}`);

  // Productos sin cover
  const rows = await dst.query(
    `SELECT p.id, p.external_id, p.plu, p.name
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_cover = true
     WHERE p.deleted_at IS NULL AND pi.id IS NULL`,
  );
  const products = rows.rows.filter((p) => p.external_id && p.plu);
  console.log(`Productos sin cover a verificar: ${products.length}\n`);

  // Construir URLs y verificar en paralelo
  const items = products.map((p) => ({
    p,
    url: `${CLOUD}/products/${p.plu}/prod_${p.external_id}`,
  }));

  let checked = 0;
  const found = [];
  await mapPool(
    items,
    async ({ p, url }) => {
      const finalUrl = await checkUrl(url);
      checked++;
      if (finalUrl) found.push({ p, url: finalUrl });
      if (checked % 200 === 0) console.log(`  ...${checked}/${items.length} verificados`);
    },
    CONCURRENCY,
  );

  console.log(`\n✅ Imágenes encontradas en Cloudinary: ${found.length} de ${items.length}`);

  if (DRY_RUN || found.length === 0) {
    await dst.end();
    console.log(`Sin cover: ${products.length - found.length}`);
    return;
  }

  // Insertar media + product_images
  let inserted = 0;
  for (const { p, url } of found) {
    const pid = Number(p.id);
    const checksum = `cdn_${pid}_${Date.now().toString(36)}`;
    const mediaRes = await dst.query(
      `INSERT INTO media (status, media_type, provider, path, file_name, mime_type,
                          size_bytes, checksum, is_public)
       VALUES ('active', 'image', 'cloudinary', $1, $2, 'image/jpeg', 0, $3, true)
       RETURNING id`,
      [url, `prod_${p.external_id}`, checksum],
    );
    await dst.query(
      `INSERT INTO product_images (product_id, media_id, is_cover, position)
       VALUES ($1, $2, true, 0)`,
      [pid, Number(mediaRes.rows[0].id)],
    );
    inserted++;
  }

  console.log(`Insertadas: ${inserted}`);
  console.log(`Sin imagen en Cloudinary: ${products.length - found.length}`);
  await dst.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
