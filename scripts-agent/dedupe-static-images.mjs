#!/usr/bin/env node
/**
 * Deduplicación completa de los estáticos locales (por contenido, MD5).
 *
 * - Escanea `db/images_static/` (productos TID, media subida, banners, etc.).
 * - Para cada grupo de archivos idénticos elige un "canónico":
 *     1) que esté referenciado en la BD
 *     2) que no esté en `products/_sin_producto`
 *     3) ruta más corta, luego orden lexicográfico
 * - Repunta en la BD todas las referencias a las copias hacia el canónico:
 *     media.path, delivery_drivers.avatar_url, settings.value->url
 * - Borra las copias sobrantes.
 * - Fusiona filas de `media` que quedaron con la misma ruta (repunta
 *   product_images y banners) y elimina filas duplicadas de product_images.
 * - Reporta archivos huérfanos (sin referencia), sin borrarlos.
 *
 * Transacción para la BD primero; los archivos se borran solo si el commit
 * fue exitoso. Dry-run por defecto.
 *
 * Uso:
 *   node scripts-agent/dedupe-static-images.mjs
 *   node scripts-agent/dedupe-static-images.mjs --apply [--json db/dedupe_report.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const SIN_PRODUCTO = path.join('products', '_sin_producto');

const APPLY = process.argv.includes('--apply');
const jsonIdx = process.argv.indexOf('--json');
const JSON_OUT = jsonIdx !== -1 ? process.argv[jsonIdx + 1] : null;

const IMAGE_EXT = new Set(['.jpeg', '.jpg', '.png', '.webp', '.gif', '.bmp', '.tiff']);

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

const urlFor = (abs) =>
  '/static/' + path.relative(STATIC_DIR, abs).split(path.sep).join('/');

async function main() {
  if (!fs.existsSync(STATIC_DIR)) throw new Error(`No existe ${STATIC_DIR}`);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const mediaRows = await client.query(`select id, path from media where path like '/static/%'`);
  const driverRows = await client.query(
    `select id, avatar_url from delivery_drivers where avatar_url like '/static/%'`,
  );
  const settingRows = await client.query(
    `select id, value from settings where value->>'url' like '/static/%'`,
  );

  const referenced = new Set([
    ...mediaRows.rows.map((r) => r.path),
    ...driverRows.rows.map((r) => r.avatar_url),
    ...settingRows.rows.map((r) => r.value.url),
  ]);

  const files = walk(STATIC_DIR).map((p) => ({ p, size: fs.statSync(p).size, url: urlFor(p) }));
  const bySize = new Map();
  for (const f of files) {
    if (!bySize.has(f.size)) bySize.set(f.size, []);
    bySize.get(f.size).push(f);
  }

  const byHash = new Map();
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    for (const f of group) {
      const h = hashFile(f.p);
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(f);
    }
  }

  const groups = [...byHash.values()].filter((g) => g.length > 1);

  const rank = (f) => [
    referenced.has(f.url) ? 0 : 1,
    f.url.includes(`/${SIN_PRODUCTO}/`) ? 1 : 0,
    f.url.length,
    f.url,
  ];
  const cmp = (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] < rb[i]) return -1;
      if (ra[i] > rb[i]) return 1;
    }
    return 0;
  };

  const replacements = []; // { from, to }
  const toDelete = [];
  let wasted = 0;

  for (const group of groups) {
    group.sort(cmp);
    const canonical = group[0];
    for (const f of group.slice(1)) {
      if (f.url !== canonical.url) replacements.push({ from: f.url, to: canonical.url });
      toDelete.push(f.p);
      wasted += f.size;
    }
  }

  // Solo hace falta repuntar las copias que estaban referenciadas.
  const relevantReplacements = replacements.filter((r) => referenced.has(r.from));

  // Huérfanos (no referenciados y que no están en _sin_producto)
  const referencedAfter = new Set(referenced);
  for (const { from, to } of relevantReplacements) {
    if (referencedAfter.delete(from)) referencedAfter.add(to);
  }
  const deleteSet = new Set(toDelete);
  const orphans = files.filter(
    (f) =>
      !referencedAfter.has(f.url) &&
      !f.url.includes(`/${SIN_PRODUCTO}/`) &&
      !deleteSet.has(f.p),
  );

  console.log(`Archivos escaneados:        ${files.length}`);
  console.log(`Grupos duplicados:          ${groups.length}`);
  console.log(`Copias a eliminar:          ${toDelete.length}`);
  console.log(`Espacio recuperable:        ${(wasted / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Referencias a repuntar:     ${relevantReplacements.length}`);
  console.log(`Huérfanos (sin tocar):      ${orphans.length}`);

  const byFolder = {};
  for (const o of orphans) {
    const key = path.relative(STATIC_DIR, o.p).split(path.sep).slice(0, 2).join('/');
    byFolder[key] = (byFolder[key] || 0) + 1;
  }
  if (orphans.length) {
    console.log('Huérfanos por carpeta:');
    for (const [k, v] of Object.entries(byFolder).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${k}: ${v}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run. Ejecuta con --apply para aplicar.');
    if (JSON_OUT) writeReport(JSON_OUT, { groups: groups.length, toDelete: toDelete.length, wasted, replacements, orphans });
    await client.end();
    return;
  }

  // ── BD: repuntar referencias + fusionar media duplicada ───────────────────
  await client.query('begin');
  try {
    for (const { from, to } of relevantReplacements) {
      await client.query(`update media set path = $1, updated_at = now() where path = $2`, [to, from]);
      await client.query(`update delivery_drivers set avatar_url = $1 where avatar_url = $2`, [to, from]);
      await client.query(
        `update settings set value = jsonb_set(value, '{url}', to_jsonb($1::text)) where value->>'url' = $2`,
        [to, from],
      );
    }

    // Fusionar media con la misma ruta (conserva el id menor)
    const dupMedia = await client.query(
      `select path, array_agg(id order by id) ids
         from media where path like '/static/%'
        group by path having count(*) > 1`,
    );
    for (const row of dupMedia.rows) {
      const [keep, ...rest] = row.ids;
      if (!rest.length) continue;
      await client.query(`update product_images set media_id = $1 where media_id = any($2)`, [
        keep,
        rest,
      ]);
      await client.query(`update banners set media_id = $1 where media_id = any($2)`, [keep, rest]);
      await client.query(`delete from media where id = any($1)`, [rest]);
    }

    // Filas duplicadas de product_images (mismo producto + media).
    // Se conserva la que sea portada y, si no, la de menor posición.
    const delPi = await client.query(
      `with ranked as (
         select id,
                row_number() over (
                  partition by product_id, media_id
                  order by is_cover desc, position asc, id asc
                ) rn
           from product_images
       )
       delete from product_images
        where id in (select id from ranked where rn > 1)`,
    );
    if (delPi.rowCount) console.log(`product_images duplicadas eliminadas: ${delPi.rowCount}`);

    // Productos con imágenes pero sin portada: promover una.
    const promoted = await client.query(
      `with pick as (
         select distinct on (pi.product_id) pi.id
           from product_images pi
          where not exists (
            select 1 from product_images c
             where c.product_id = pi.product_id and c.is_cover
          )
          order by pi.product_id, pi.position asc, pi.id asc
       )
       update product_images p set is_cover = true, updated_at = now()
        from pick where p.id = pick.id`,
    );
    if (promoted.rowCount) console.log(`portadas promovidas: ${promoted.rowCount}`);

    // Si por lo que sea quedara más de una portada, dejar solo una.
    await client.query(
      `with ranked as (
         select id, row_number() over (
                  partition by product_id order by position asc, id asc
                ) rn
           from product_images
          where is_cover
       )
       update product_images set is_cover = false
        where id in (select id from ranked where rn > 1)`,
    );

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    await client.end();
    throw err;
  }

  // ── Archivos: borrar copias sobrantes ─────────────────────────────────────
  let deleted = 0;
  for (const p of toDelete) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted++;
    }
  }

  console.log(`\nMedia fusionada:            ${(await client.query(
    `select count(*) from media where path like '/static/%'`,
  )).rows[0].count}`);
  console.log(`Archivos eliminados:        ${deleted}`);

  if (JSON_OUT) writeReport(JSON_OUT, { groups: groups.length, deleted, wasted, replacements, orphans });
  await client.end();
}

function writeReport(out, data) {
  const abs = path.resolve(ROOT, out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        static_dir: 'db/images_static',
        duplicate_groups: data.groups,
        deleted_or_to_delete: data.deleted ?? data.toDelete,
        wasted_bytes: data.wasted,
        replacements: data.replacements.slice(0, 5000),
        orphans: data.orphans.map((o) => ({ url: o.url, size: o.size })),
      },
      null,
      2,
    ),
  );
  console.log(`Reporte: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
