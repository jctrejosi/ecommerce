#!/usr/bin/env node
/**
 * Migra los assets de Cloudinary a disco y repunta las referencias de la BD:
 *
 *   - descarga cada asset a `db/images_static/<public_id>.<formato>`
 *   - actualiza `media.path` a la ruta local `/static/media/<...>`
 *   - guarda la URL original en `metadata.cloudinary_url` (respaldo)
 *   - actualiza `avatar_url` de repartidores y usuarios si apuntaban a Cloudinary
 *
 * Es idempotente: los archivos ya descargados (mismo tamaño) no se bajan de nuevo.
 *
 * Uso:
 *   node scripts-agent/migrate-cloudinary-to-local.mjs --dry-run
 *   node scripts-agent/migrate-cloudinary-to-local.mjs
 */
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const dotenv = require('dotenv');
const { v2: cloudinary } = require('cloudinary');
const { Client } = require('pg');

const backendDir = fileURLToPath(new URL('../backend/', import.meta.url));
dotenv.config({ path: path.join(backendDir, '.env.development.local') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const OUT_DIR = fileURLToPath(new URL('../db/images_static/', import.meta.url));

const DRY = process.argv.includes('--dry-run');
const CONCURRENCY = 6;

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

async function listAssets() {
  const out = [];
  let cursor;
  for (let page = 0; page < 200; page++) {
    const res = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'image',
      max_results: 500,
      next_cursor: cursor,
    });
    out.push(...res.resources);
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function pool(items, size, fn) {
  let index = 0;
  const workers = Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = index++;
      await fn(items[current]);
    }
  });
  await Promise.all(workers);
}

const assets = await listAssets();
console.log(`Assets en Cloudinary: ${assets.length}${DRY ? ' (dry-run)' : ''}`);

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const stats = {
  descargados: 0,
  yaEstaban: 0,
  fallidos: 0,
  mediaActualizados: 0,
  avataresActualizados: 0,
  sinFilaEnMedia: [],
};
const errors = [];

await pool(assets, CONCURRENCY, async (asset) => {
  const ext = asset.format || 'jpg';
  const publicId = asset.public_id;
  const fileName = `${publicId}.${ext}`;
  const dest = path.join(OUT_DIR, fileName);
  const localPath = `/static/media/${fileName}`;

  try {
    if (DRY) {
      stats.descargados++;
    } else {
      const existing = await fsp
        .stat(dest)
        .then((s) => s.size === asset.bytes)
        .catch(() => false);
      if (existing) {
        stats.yaEstaban++;
      } else {
        const res = await fetch(asset.secure_url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, buf);
        stats.descargados++;
      }

      const upd = await client.query(
        `UPDATE media
            SET path = $1,
                provider = 'local',
                file_name = $2,
                mime_type = $3,
                size_bytes = $4,
                width = COALESCE($5, width),
                height = COALESCE($6, height),
                metadata = (COALESCE(metadata, '{}'::jsonb))
                           || jsonb_build_object(
                                'cloudinary_url', path,
                                'source', 'cloudinary-mirror'
                              ),
                updated_at = now()
          WHERE path = $7`,
        [
          localPath,
          path.basename(fileName).slice(0, 255),
          MIME[ext] ?? `image/${ext}`,
          asset.bytes ?? 0,
          asset.width ?? null,
          asset.height ?? null,
          asset.secure_url,
        ],
      );
      stats.mediaActualizados += upd.rowCount;
      if (upd.rowCount === 0) stats.sinFilaEnMedia.push(publicId);

      // Avatares (repartidores / usuarios) que guardan la URL directa.
      for (const table of ['delivery_drivers', 'users']) {
        try {
          const av = await client.query(
            `UPDATE ${table} SET avatar_url = $1 WHERE avatar_url = $2`,
            [localPath, asset.secure_url],
          );
          stats.avataresActualizados += av.rowCount;
        } catch (error) {
          if (!String(error.message).includes('does not exist')) throw error;
        }
      }
    }
  } catch (error) {
    stats.fallidos++;
    if (errors.length < 10) errors.push(`${publicId}: ${error.message}`);
  }
});

// Segunda pasada: filas de media que referencian el asset con transformaciones
// u otra versión de la URL (no coincidieron exacto por secure_url).
if (!DRY) {
  const leftover = await client.query(
    `SELECT id, path FROM media WHERE provider = 'cloudinary'`,
  );
  let fallback = 0;
  for (const row of leftover.rows) {
    const asset = assets.find((a) => row.path.includes(a.public_id));
    if (!asset) continue;
    const ext = asset.format || 'jpg';
    const localPath = `/static/media/${asset.public_id}.${ext}`;
    const upd = await client.query(
      `UPDATE media
          SET path = $1, provider = 'local',
              metadata = (COALESCE(metadata, '{}'::jsonb))
                         || jsonb_build_object('cloudinary_url', path, 'source', 'cloudinary-mirror'),
              updated_at = now()
        WHERE id = $2`,
      [localPath, row.id],
    );
    fallback += upd.rowCount;
  }
  stats.mediaActualizados += fallback;
}

const remaining = await client.query(
  `SELECT count(*)::int AS n FROM media WHERE provider = 'cloudinary'`,
);

console.log(`\nResultado${DRY ? ' (dry-run)' : ''}:`);
console.log(`  descargados          : ${stats.descargados}`);
console.log(`  ya estaban en disco  : ${stats.yaEstaban}`);
console.log(`  fallidos             : ${stats.fallidos}`);
console.log(`  media repuntados     : ${stats.mediaActualizados}`);
console.log(`  avatares repuntados  : ${stats.avataresActualizados}`);
console.log(`  assets sin fila media: ${stats.sinFilaEnMedia.length}`);
console.log(`  media aún cloudinary : ${remaining.rows[0].n}`);
if (errors.length) console.log(`  errores              : ${errors.join(' | ')}`);
if (stats.sinFilaEnMedia.length)
  console.log(
    `  ejemplos sin media   : ${stats.sinFilaEnMedia.slice(0, 8).join(', ')}`,
  );

await client.end();
