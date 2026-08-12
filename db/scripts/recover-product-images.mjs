#!/usr/bin/env node
/**
 * Recupera imágenes de productos desde el backup que las contiene
 * (catálogo anterior con media Cloudinary) y las re-asocia a los
 * productos actuales por external_id → plu → nombre.
 *
 * Uso:
 *   TARGET_DATABASE_URL='postgresql://...' node recover-product-images.mjs
 *
 * Variables:
 *   SOURCE_DATABASE_URL  (default: postgresql://postgres:postgres@localhost:5432/backup_inspect)
 *   TARGET_DATABASE_URL  (obligatoria: BD destino — local o Supabase)
 *   TARGET_DB_SSL=1      SSL hacia el destino (Supabase)
 *   DRY_RUN=1            solo reporta, no inserta
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require(
  "/home/jk/Projects/dsi/mercaldas-ecommerce/backend/node_modules/pg",
);

const SOURCE_URL =
  process.env.SOURCE_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/backup_inspect";
const TARGET_URL = process.env.TARGET_DATABASE_URL || "";
const TARGET_SSL = process.env.TARGET_DB_SSL === "1";
const DRY_RUN = process.env.DRY_RUN === "1";

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

async function connect(url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

async function main() {
  if (!TARGET_URL) fail("Define TARGET_DATABASE_URL");
  console.log("━━━ Recuperación de imágenes de productos ━━━");

  const src = await connect(SOURCE_URL, false);
  const dst = await connect(TARGET_URL, TARGET_SSL ? { rejectUnauthorized: false } : false);
  console.log(`Fuente : ${src.connectionParameters.database}`);
  console.log(`Destino: ${dst.connectionParameters.database}${DRY_RUN ? " (DRY RUN)" : ""}`);

  // 1. Backup: productos con su imagen cover (media Cloudinary)
  const backupRows = await src.query(
    `SELECT p.id AS pid, p.external_id, p.plu, lower(btrim(p.name)) AS name,
            m.path, m.file_name, m.mime_type, m.size_bytes, m.width, m.height
     FROM products p
     JOIN product_images pi ON pi.product_id = p.id AND pi.is_cover = true
     JOIN media m ON m.id = pi.media_id
     WHERE m.path LIKE '%res.cloudinary.com%'`,
  );

  const byEid = new Map();
  const byPlu = new Map();
  const byName = new Map();
  for (const r of backupRows.rows) {
    const entry = {
      path: r.path,
      fileName: r.file_name,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes ?? 0),
      width: r.width ? Number(r.width) : null,
      height: r.height ? Number(r.height) : null,
    };
    if (r.external_id) byEid.set(String(r.external_id), entry);
    if (r.plu) byPlu.set(String(r.plu), entry);
    if (r.name) byName.set(norm(r.name), entry);
  }
  console.log(`Backup: ${backupRows.rows.length} productos con imagen Cloudinary\n`);

  // 2. Productos actuales
  const current = await dst.query(
    `SELECT id, external_id, plu, name FROM products WHERE deleted_at IS NULL`,
  );
  console.log(`Destino: ${current.rows.length} productos`);

  // Covers existentes (una sola consulta)
  const covers = await dst.query(
    `SELECT DISTINCT product_id FROM product_images WHERE is_cover = true`,
  );
  const hasCoverSet = new Set(covers.rows.map((r) => Number(r.product_id)));

  // 3. Coincidir y asociar
  let matched = 0;
  let skipped = 0;
  const matchedLog = [];
  for (const p of current.rows) {
    const pid = Number(p.id);

    // Ya tiene imagen cover?
    if (hasCoverSet.has(pid)) {
      skipped++;
      continue;
    }

    const entry =
      (p.external_id && byEid.get(String(p.external_id))) ||
      (p.plu && byPlu.get(String(p.plu))) ||
      byName.get(norm(p.name));

    if (!entry) continue;

    if (!DRY_RUN) {
      // Insertar media (checksum único por producto)
      const checksum = `recover_${pid}_${Date.now().toString(36)}`;
      const mediaRes = await dst.query(
        `INSERT INTO media (status, media_type, provider, path, file_name, mime_type,
                            size_bytes, width, height, checksum, is_public)
         VALUES ('active', 'image', 'cloudinary', $1, $2, $3, $4, $5, $6, $7, true)
         RETURNING id`,
        [entry.path, entry.fileName, entry.mimeType, entry.sizeBytes, entry.width, entry.height, checksum],
      );
      const mediaId = Number(mediaRes.rows[0].id);
      await dst.query(
        `INSERT INTO product_images (product_id, media_id, is_cover, position)
         VALUES ($1, $2, true, 0)`,
        [pid, mediaId],
      );
    }

    matched++;
    if (matched <= 10) matchedLog.push(`  ${pid} → ${entry.path.slice(0, 90)}`);
  }

  console.log(matchedLog.join("\n"));
  console.log(`\n✅ Coincidencias con imagen: ${matched}${DRY_RUN ? " (dry run)" : " (insertadas)"}`);
  console.log(`   Productos que ya tenían cover: ${skipped}`);
  console.log(`   Productos SIN imagen recuperable: ${current.rows.length - matched - skipped}`);

  await src.end();
  await dst.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
