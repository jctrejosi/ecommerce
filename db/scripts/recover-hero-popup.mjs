#!/usr/bin/env node
/**
 * Recupera los banners hero/promo y el popup (con sus imágenes Cloudinary)
 * desde el backup hacia la BD destino.
 *
 * Copia: media (hero desktop+mobile, promo, popup), saved_filters,
 * banners hero+promo y el popup.
 *
 * Uso:
 *   TARGET_DATABASE_URL='...' node recover-hero-popup.mjs
 *   TARGET_DB_SSL=1  (Supabase)
 *   DRY_RUN=1
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

async function connect(url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

async function main() {
  if (!TARGET_URL) fail("Define TARGET_DATABASE_URL");
  console.log("━━━ Recuperación de banners hero/promo y popup ━━━");

  const src = await connect(SOURCE_URL, false);
  const dst = await connect(TARGET_URL, TARGET_SSL ? { rejectUnauthorized: false } : false);
  console.log(`Fuente : ${src.connectionParameters.database}`);
  console.log(`Destino: ${dst.connectionParameters.database}${DRY_RUN ? " (DRY RUN)" : ""}`);

  // 1. Copiar media (hero desktop+mobile, promo, popup)
  const mediaIds = [2707, 2708, 2701, 2702, 2705, 2706, 2709, 2710, 2711, 2712, 2716, 2718, 2714];
  const mediaRows = await src.query(
    `SELECT id, path, file_name, mime_type, size_bytes, width, height, alt_text, media_type, provider
     FROM media WHERE id = ANY($1::bigint[])`,
    [mediaIds],
  );

  const mediaMap = new Map();
  for (const m of mediaRows.rows) {
    const oldId = Number(m.id);
    // Reutilizar media existente con la misma path
    const existing = await dst.query(`SELECT id FROM media WHERE path = $1 LIMIT 1`, [m.path]);
    if (existing.rows.length) {
      mediaMap.set(oldId, Number(existing.rows[0].id));
      console.log(`  media ${oldId}: ya existe (id ${mediaMap.get(oldId)})`);
      continue;
    }
    if (DRY_RUN) {
      mediaMap.set(oldId, 0);
      console.log(`  media ${oldId}: (dry) se insertaría ${m.path.slice(0, 60)}`);
      continue;
    }
    const checksum = `hero_${oldId}_${Date.now().toString(36)}`;
    const ins = await dst.query(
      `INSERT INTO media (status, media_type, provider, path, file_name, mime_type,
                          size_bytes, width, height, checksum, alt_text, is_public)
       VALUES ('active', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING id`,
      [m.media_type || 'image', m.provider || 'cloudinary', m.path, m.file_name, m.mime_type,
       m.size_bytes ?? 0, m.width ?? null, m.height ?? null, checksum, m.alt_text ?? null],
    );
    mediaMap.set(oldId, Number(ins.rows[0].id));
    console.log(`  media ${oldId} → nuevo id ${mediaMap.get(oldId)}`);
  }

  // 2. saved_filters (ids 1,2,3) — restaurar si faltan
  const filters = await src.query(`SELECT * FROM saved_filters ORDER BY id`);
  let filtersDone = 0;
  for (const f of filters.rows) {
    const exists = await dst.query(`SELECT id FROM saved_filters WHERE id = $1`, [Number(f.id)]);
    if (exists.rows.length) continue;
    if (!DRY_RUN) {
      await dst.query(
        `INSERT INTO saved_filters (id, name, description, category_ids, brand_id, product_type_code,
                                    on_sale, search, sort, price_min, price_max, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [Number(f.id), f.name, f.description, f.category_ids ? JSON.stringify(f.category_ids) : null, f.brand_id, f.product_type_code,
         f.on_sale, f.search, f.sort, f.price_min, f.price_max, f.is_active, f.created_at, f.updated_at],
      );
    }
    filtersDone++;
    console.log(`  saved_filter ${f.id} (${f.name})`);
  }

  // 3. Banners hero+promo: reemplazar los existentes en el destino
  const banners = await src.query(
    `SELECT id, title, media_id, link_url, link_target, alt_text, description, subtitle,
            cta_text, bg_color, accent_color, banner_type, position, is_active,
            start_date, end_date, mobile_image_id, filter_id, clicks, views
     FROM banners WHERE banner_type IN ('hero','promo') ORDER BY banner_type, position, id`,
  );

  let bannersDone = 0;
  if (!DRY_RUN) {
    await dst.query(`DELETE FROM banners WHERE banner_type IN ('hero','promo')`);
  }
  for (const b of banners.rows) {
    const mediaId = mediaMap.get(Number(b.media_id)) ?? null;
    const mobileId = b.mobile_image_id ? mediaMap.get(Number(b.mobile_image_id)) ?? null : null;
    if (!DRY_RUN) {
      await dst.query(
        `INSERT INTO banners (title, media_id, link_url, link_target, alt_text, description, subtitle,
                              cta_text, bg_color, accent_color, banner_type, position, is_active,
                              start_date, end_date, mobile_image_id, filter_id, clicks, views)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [b.title, mediaId, b.link_url, b.link_target, b.alt_text, b.description, b.subtitle,
         b.cta_text, b.bg_color, b.accent_color, b.banner_type, b.position, b.is_active,
         b.start_date, b.end_date, mobileId, b.filter_id ?? null, b.clicks ?? 0, b.views ?? 0],
      );
    }
    bannersDone++;
    console.log(`  banner ${b.banner_type} pos=${b.position} (media ${b.media_id} → ${mediaId})`);
  }

  // 4. Popup (solo si no hay popups en el destino)
  const popupsCount = (await dst.query(`SELECT count(*)::int AS n FROM popups`)).rows[0].n;
  if (popupsCount === 0) {
    const popup = await src.query(`SELECT * FROM popups WHERE id = 1`);
    if (popup.rows.length) {
      const p = popup.rows[0];
      const imageMediaId = mediaMap.get(Number(p.image_media_id)) ?? null;
      if (!DRY_RUN) {
        await dst.query(
          `INSERT INTO popups (title, image_media_id, position, filter_config, duration_ms, delay_ms,
                               is_active, start_date, end_date, max_height)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [p.title, imageMediaId, p.position, p.filter_config ? JSON.stringify(p.filter_config) : null, p.duration_ms, p.delay_ms,
           p.is_active, p.start_date, p.end_date, p.max_height ?? null],
        );
      }
      console.log(`  popup: "${p.title}" (media ${p.image_media_id} → ${imageMediaId})`);
    }
  } else {
    console.log(`  popup: omitido (el destino ya tiene ${popupsCount} popups)`);
  }

  console.log(`\n✅ Media copiadas: ${mediaMap.size} | filters: ${filtersDone} | banners: ${bannersDone}${DRY_RUN ? " (dry run)" : ""}`);
  await src.end();
  await dst.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
