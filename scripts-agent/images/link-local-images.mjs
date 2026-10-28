/**
 * Vincula a `media` + `product_images` los archivos de imagen que ya existen en
 * disco pero nunca se enlazaron a su producto.
 *
 * Orígenes soportados:
 *   - db/images_static/media/products/<productId>/<archivo>  → /static/media/products/<id>/<archivo>
 *   - db/images_static/products/<barcode>.JPEG                → /static/products/<archivo>
 *
 * Sólo toca productos ACTIVOS que hoy no tienen ninguna imagen con `path`.
 * Sólo lee por defecto (dry-run).
 *
 * Uso:
 *   node scripts-agent/images/link-local-images.mjs
 *   node scripts-agent/images/link-local-images.mjs --apply
 *   node scripts-agent/images/link-local-images.mjs --apply --limit=10
 *   node scripts-agent/images/link-local-images.mjs --rollback=db/backups/xxx.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from '../erp/openads.mjs';
import { args, ROOT, log } from '../erp/lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LIMIT = a.limit ? Number(a.limit) : Infinity;

const MEDIA_DIR = path.join(ROOT, 'db/images_static/media/products');
const FLAT_DIR = path.join(ROOT, 'db/images_static/products');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const SNAPSHOT = path.join(ROOT, 'db/backups', `link-local-images-${STAMP}.json`);

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const pg = createPg();

// ── Rollback ─────────────────────────────────────────────────────────
async function rollback(file) {
  const snap = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  await pg.connect();
  await pg.query('BEGIN');
  await pg.query(`SET LOCAL app.erp_sync = 'on'`);
  const piIds = (snap.created ?? []).map((c) => c.product_image_id).filter(Boolean);
  const mIds = (snap.created ?? []).map((c) => c.media_id).filter(Boolean);
  const delPi = piIds.length
    ? await pg.query(`DELETE FROM product_images WHERE id = ANY($1::bigint[])`, [piIds])
    : { rowCount: 0 };
  const delM = mIds.length
    ? await pg.query(`DELETE FROM media WHERE id = ANY($1::bigint[])`, [mIds])
    : { rowCount: 0 };
  await pg.query('COMMIT');
  log(`↩️  rollback: ${delPi.rowCount} product_images y ${delM.rowCount} media eliminados`);
  await pg.end();
}

if (a.rollback) {
  await rollback(a.rollback);
  process.exit(0);
}

await pg.connect();

// ── 1. Productos activos sin imagen enlazada ─────────────────────────
const rows = (
  await pg.query(`
    SELECT p.id, p.name, p.plu,
           COALESCE(array_agg(DISTINCT NULLIF(btrim(pv.barcode), '')) FILTER (WHERE pv.barcode IS NOT NULL), '{}') AS barcodes,
           COALESCE(array_agg(DISTINCT NULLIF(btrim(pv.sku), '')) FILTER (WHERE pv.sku IS NOT NULL), '{}') AS skus
      FROM products p
      JOIN product_variants pv ON pv.product_id = p.id
     WHERE p.is_active AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_images pi
           JOIN media m ON m.id = pi.media_id
          WHERE pi.product_id = p.id AND m.path IS NOT NULL
       )
     GROUP BY p.id, p.name, p.plu
     ORDER BY p.id
  `)
).rows;

// ── 2. Índice de archivos planos (nombre sin extensión → archivo) ────
const flatIndex = new Map();
if (fs.existsSync(FLAT_DIR)) {
  for (const f of fs.readdirSync(FLAT_DIR)) {
    if (!MIME[path.extname(f).toLowerCase()]) continue;
    flatIndex.set(path.basename(f, path.extname(f)).toUpperCase(), f);
  }
}

function resolveFile(id, barcodes, skus, plu) {
  // 1) carpeta dedicada por producto
  const dir = path.join(MEDIA_DIR, String(id));
  if (fs.existsSync(dir)) {
    const f = fs
      .readdirSync(dir)
      .filter((x) => MIME[path.extname(x).toLowerCase()])
      .sort()[0];
    if (f) {
      return {
        abs: path.join(dir, f),
        publicPath: `/static/media/products/${id}/${f}`,
        file: f,
      };
    }
  }
  // 2) archivo plano por barcode / sku / plu
  for (const key of [...barcodes, ...skus, plu]) {
    const k = String(key ?? '').trim().toUpperCase();
    if (!k) continue;
    const f = flatIndex.get(k);
    if (f) {
      return {
        abs: path.join(FLAT_DIR, f),
        publicPath: `/static/products/${f}`,
        file: f,
      };
    }
  }
  return null;
}

const candidates = [];
for (const r of rows) {
  if (candidates.length >= LIMIT) break;
  const hit = resolveFile(r.id, r.barcodes ?? [], r.skus ?? [], r.plu);
  if (hit) candidates.push({ ...r, ...hit });
}

log(`Productos activos sin imagen: ${rows.length}`);
log(`Con archivo local disponible: ${candidates.length}`);

if (!candidates.length) {
  await pg.end();
  process.exit(0);
}

// ── 3. Chequeos de unicidad (checksum y cover) ───────────────────────
const checksums = candidates.map((c) => `local:tid:${c.file}`);
const taken = new Map(
  (
    await pg.query(`SELECT checksum, id, path FROM media WHERE checksum = ANY($1::text[])`, [
      checksums,
    ])
  ).rows.map((r) => [r.checksum, r]),
);

const covers = new Map(
  (
    await pg.query(
      `SELECT product_id, id FROM product_images WHERE is_cover AND product_id = ANY($1::bigint[])`,
      [candidates.map((c) => c.id)],
    )
  ).rows.map((r) => [Number(r.product_id), Number(r.id)]),
);

const plan = candidates.map((c) => {
  let checksum = `local:tid:${c.file}`;
  if (taken.has(checksum)) {
    const prev = taken.get(checksum);
    checksum = prev.path === c.publicPath ? checksum : `local:tid:${c.id}:${c.file}`;
  }
  const stat = fs.statSync(c.abs);
  return {
    ...c,
    checksum,
    mime: MIME[path.extname(c.file).toLowerCase()],
    size: stat.size,
    isCover: !covers.has(Number(c.id)),
  };
});

log('');
for (const p of plan.slice(0, 8)) {
  log(
    `  ${p.id}  ${p.file.padEnd(36)} ${String(p.size).padStart(9)} B  ` +
      `${p.publicPath}${p.isCover ? '' : '  (ya tenía cover)'}`,
  );
}
if (plan.length > 8) log(`  … y ${plan.length - 8} más`);

if (!APPLY) {
  log(`\n(dry-run) usa --apply para escribir ${plan.length} media + product_images`);
  await pg.end();
  process.exit(0);
}

// ── 4. Aplicar ───────────────────────────────────────────────────────
const snapshot = { generated_at: new Date().toISOString(), applied: true, created: [] };

await pg.query('BEGIN');
await pg.query(`SET LOCAL app.erp_sync = 'on'`);

try {
  for (const p of plan) {
    const m = await pg.query(
      `INSERT INTO media
         (status, media_type, provider, path, file_name, mime_type, size_bytes,
          checksum, metadata, is_public)
       VALUES ('active', 'image', 'local', $1, $2, $3, $4, $5, $6::jsonb, true)
       RETURNING id`,
      [
        p.publicPath,
        p.file,
        p.mime,
        p.size,
        p.checksum,
        JSON.stringify({ file: p.file, match: 'local-scan', source: 'link-local-images' }),
      ],
    );
    const mediaId = Number(m.rows[0].id);

    const pi = await pg.query(
      `INSERT INTO product_images (product_id, media_id, is_cover, position)
       VALUES ($1, $2, $3, 0)
       RETURNING id`,
      [p.id, mediaId, p.isCover],
    );

    snapshot.created.push({
      product_id: Number(p.id),
      media_id: mediaId,
      product_image_id: Number(pi.rows[0].id),
      path: p.publicPath,
    });
  }
  await pg.query('COMMIT');
} catch (err) {
  await pg.query('ROLLBACK');
  throw err;
}

fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));

// ── 5. Verificación ──────────────────────────────────────────────────
const left = (
  await pg.query(`
    SELECT count(*)::int AS n
      FROM products p
     WHERE p.is_active AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_images pi
           JOIN media m ON m.id = pi.media_id
          WHERE pi.product_id = p.id AND m.path IS NOT NULL
       )
  `)
).rows[0].n;

log(`\n✅ ${snapshot.created.length} productos vinculados`);
log(`   media:          ${snapshot.created.length}`);
log(`   product_images: ${snapshot.created.length}`);
log(`   snapshot:       ${path.relative(ROOT, SNAPSHOT)}`);
log(`   activos aún sin imagen: ${left}`);

await pg.end();
