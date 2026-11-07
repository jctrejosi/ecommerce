/**
 * Mueve al proyecto las imágenes descargadas por el scanner
 * (`images_products/<plu>__<barcode>.<ext>`) y las vincula al producto.
 *
 * Destino: db/images_static/media/products/<productId>/prod_<plu>.<ext>
 *          (servido en /static/media/products/<productId>/prod_<plu>.<ext>)
 *
 * Reglas:
 *   - El nombre del archivo trae PLU + EAN; se resuelve el producto por PLU en
 *     Postgres y se exige que el EAN esté entre sus variantes.
 *   - Sólo productos ACTIVOS y sin imagen vinculada.
 *   - Dry-run por defecto. `--apply` mueve y escribe en `media` + `product_images`.
 *
 * Uso:
 *   node scripts-agent/images/import-scraped-images.mjs
 *   node scripts-agent/images/import-scraped-images.mjs --apply
 *   node scripts-agent/images/import-scraped-images.mjs --apply --src=/otra/ruta
 *   node scripts-agent/images/import-scraped-images.mjs --rollback=db/backups/xxx.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from '../erp/openads.mjs';
import { args, ROOT, log } from '../erp/lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LIMIT = a.limit ? Number(a.limit) : Infinity;
const SRC = path.resolve(
  a.src || '/home/jk/Proyectos/seeds/Vassago/web_scraper/scanner/images_products',
);
const DEST_ROOT = path.join(ROOT, 'db/images_static/media/products');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const SNAPSHOT = path.join(ROOT, 'db/backups', `import-scraped-images-${STAMP}.json`);

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
  const created = snap.created ?? [];

  // devolver los archivos a su ruta original
  let restored = 0;
  for (const c of created) {
    if (!fs.existsSync(c.dst)) continue;
    fs.mkdirSync(path.dirname(c.src), { recursive: true });
    fs.renameSync(c.dst, c.src);
    restored++;
  }

  await pg.connect();
  await pg.query('BEGIN');
  await pg.query(`SET LOCAL app.erp_sync = 'on'`);
  const piIds = created.map((c) => c.product_image_id).filter(Boolean);
  const mIds = created.map((c) => c.media_id).filter(Boolean);
  const delPi = piIds.length
    ? await pg.query(`DELETE FROM product_images WHERE id = ANY($1::bigint[])`, [piIds])
    : { rowCount: 0 };
  const delM = mIds.length
    ? await pg.query(`DELETE FROM media WHERE id = ANY($1::bigint[])`, [mIds])
    : { rowCount: 0 };
  await pg.query('COMMIT');
  log(`↩️  rollback: ${delPi.rowCount} product_images, ${delM.rowCount} media, ${restored} archivos devueltos`);
  await pg.end();
}

if (a.rollback) {
  await rollback(a.rollback);
  process.exit(0);
}

if (!fs.existsSync(SRC)) throw new Error(`No existe el directorio origen: ${SRC}`);

// ── 1. Inventario de archivos origen ─────────────────────────────────
const files = fs
  .readdirSync(SRC)
  .filter((f) => MIME[path.extname(f).toLowerCase()])
  .map((f) => {
    const m = f.match(/^(\d+)__(\d+)\.(jpe?g|png|webp)$/i);
    if (!m) return { file: f, error: 'nombre no reconocido' };
    return { file: f, plu: m[1], barcode: m[2], ext: `.${m[3].toLowerCase()}` };
  });

const malformed = files.filter((f) => f.error);
const valid = files.filter((f) => !f.error);
log(`Origen: ${valid.length} imágenes (${malformed.length} con nombre inválido)`);

await pg.connect();

// ── 2. Resolver productos por PLU ────────────────────────────────────
const plus = [...new Set(valid.map((f) => f.plu))];
const dbRows = (
  await pg.query(
    `SELECT p.id, p.name, p.plu, p.is_active,
            COALESCE(array_agg(DISTINCT NULLIF(btrim(pv.barcode), '')) FILTER (WHERE pv.barcode IS NOT NULL), '{}') AS barcodes,
            EXISTS (
              SELECT 1 FROM product_images pi JOIN media m ON m.id = pi.media_id
               WHERE pi.product_id = p.id AND m.path IS NOT NULL
            ) AS has_image
       FROM products p
       JOIN product_variants pv ON pv.product_id = p.id
      WHERE btrim(p.plu) = ANY($1::text[])
        AND p.deleted_at IS NULL
      GROUP BY p.id, p.name, p.plu, p.is_active`,
    [plus],
  )
).rows;

const byPlu = new Map();
for (const r of dbRows) {
  const k = String(r.plu).trim();
  if (!byPlu.has(k)) byPlu.set(k, []);
  byPlu.get(k).push(r);
}

const plan = [];
const problems = [];
for (const f of valid) {
  if (plan.length >= LIMIT) break;
  const hits = byPlu.get(f.plu) ?? [];
  if (!hits.length) {
    problems.push(`PLU ${f.plu} no existe: ${f.file}`);
    continue;
  }
  if (hits.length > 1) {
    problems.push(`PLU ${f.plu} ambiguo (${hits.length} productos): ${f.file}`);
    continue;
  }
  const p = hits[0];
  if (!p.is_active) {
    problems.push(`producto ${p.id} inactivo: ${f.file}`);
    continue;
  }
  if (p.has_image) {
    problems.push(`producto ${p.id} ya tiene imagen: ${f.file}`);
    continue;
  }
  if (!(p.barcodes ?? []).map(String).includes(f.barcode)) {
    problems.push(`EAN ${f.barcode} no pertenece al producto ${p.id}: ${f.file}`);
    continue;
  }
  const dir = path.join(DEST_ROOT, String(p.id));
  const fileName = `prod_${f.plu}${f.ext}`;
  const dst = path.join(dir, fileName);
  if (fs.existsSync(dst)) {
    problems.push(`destino ya existe: ${path.relative(ROOT, dst)}`);
    continue;
  }
  plan.push({
    file: f.file,
    src: path.join(SRC, f.file),
    dst,
    relDst: path.relative(ROOT, dst),
    publicPath: `/static/media/products/${p.id}/${fileName}`,
    fileName,
    mime: MIME[f.ext],
    size: fs.statSync(path.join(SRC, f.file)).size,
    productId: Number(p.id),
    productName: p.name,
    plu: f.plu,
    barcode: f.barcode,
  });
}

const pending = valid.length - plan.length - problems.length;
log(`Vinculables: ${plan.length} · con problema: ${problems.length} · fuera de límite: ${Math.max(0, pending)}`);
if (problems.length) {
  log('\nPrimeros problemas:');
  for (const p of problems.slice(0, 10)) log('  ' + p);
}
if (plan.length) {
  log('\nPrimeros destinos:');
  for (const p of plan.slice(0, 5)) log(`  ${p.file} → ${p.relDst}`);
}

if (!APPLY) {
  log(`\n(dry-run) usa --apply para mover ${plan.length} archivos y vincularlos`);
  await pg.end();
  process.exit(0);
}

// ── 3. Aplicar: mover + insertar ──────────────────────────────────────
const snapshot = {
  generated_at: new Date().toISOString(),
  source_dir: SRC,
  created: [],
};

fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });

await pg.query('BEGIN');
await pg.query(`SET LOCAL app.erp_sync = 'on'`);

try {
  for (const p of plan) {
    fs.mkdirSync(path.dirname(p.dst), { recursive: true });
    try {
      fs.renameSync(p.src, p.dst);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fs.copyFileSync(p.src, p.dst);
      fs.unlinkSync(p.src);
    }

    const m = await pg.query(
      `INSERT INTO media
         (status, media_type, provider, path, file_name, mime_type, size_bytes,
          checksum, metadata, is_public)
       VALUES ('active', 'image', 'local', $1, $2, $3, $4, $5, $6::jsonb, true)
       RETURNING id`,
      [
        p.publicPath,
        p.fileName,
        p.mime,
        p.size,
        `local:scrape:${p.plu}:${p.barcode}`,
        JSON.stringify({
          file: p.fileName,
          original: p.file,
          match: 'scanner-plu-barcode',
          source: 'import-scraped-images',
          plu: p.plu,
          barcode: p.barcode,
        }),
      ],
    );
    const mediaId = Number(m.rows[0].id);

    const pi = await pg.query(
      `INSERT INTO product_images (product_id, media_id, is_cover, position)
       VALUES ($1, $2, true, 0)
       RETURNING id`,
      [p.productId, mediaId],
    );

    snapshot.created.push({
      product_id: p.productId,
      media_id: mediaId,
      product_image_id: Number(pi.rows[0].id),
      src: p.src,
      dst: p.dst,
      path: p.publicPath,
    });
  }
  await pg.query('COMMIT');
} catch (err) {
  await pg.query('ROLLBACK');
  throw err;
}

// se escribe después del commit; si el proceso muere antes, el rollback manual
// puede reconstruirse desde el log pero no desde el snapshot.
fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));

// ── 4. Verificación ──────────────────────────────────────────────────
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

log(`\n✅ ${snapshot.created.length} imágenes movidas y vinculadas`);
log(`   snapshot: ${path.relative(ROOT, SNAPSHOT)}`);
log(`   activos aún sin imagen: ${left}`);

await pg.end();
