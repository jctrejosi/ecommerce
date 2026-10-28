/**
 * Importa los íconos de las categorías raíz descargados por el scanner
 * (`icon_categories/<idVTEX>__<slug>.<ext>`) y los asigna a la categoría.
 *
 * Destino: db/images_static/media/categories/<categoryId>/<slug>.<ext>
 *          (servido en /static/media/categories/<categoryId>/<slug>.<ext>)
 *
 * Escribe `media` y actualiza `categories.image_media_id`. La landing
 * (`/landing/categories`) ya devuelve `imagePath`, así que el carousel pasa a
 * usar la imagen en vez del emoji.
 *
 * Dry-run por defecto. `--apply` para escribir.
 *
 * Uso:
 *   node scripts-agent/images/import-category-icons.mjs
 *   node scripts-agent/images/import-category-icons.mjs --apply
 *   node scripts-agent/images/import-category-icons.mjs --rollback=db/backups/xxx.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from '../erp/openads.mjs';
import { args, ROOT, log } from '../erp/lib.mjs';

const a = args();
const APPLY = !!a.apply;
const SRC = path.resolve(
  a.src || '/home/jk/Proyectos/seeds/Vassago/web_scraper/scanner/icon_categories',
);
const DEST_ROOT = path.join(ROOT, 'db/images_static/media/categories');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const SNAPSHOT = path.join(ROOT, 'db/backups', `category-icons-${STAMP}.json`);

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const pg = createPg();

async function rollback(file) {
  const snap = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const created = snap.created ?? [];

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
  for (const c of created) {
    await pg.query(`UPDATE categories SET image_media_id = $1 WHERE id = $2`, [
      c.previous_media_id ?? null,
      c.category_id,
    ]);
  }
  const mIds = created.map((c) => c.media_id).filter(Boolean);
  const delM = mIds.length
    ? await pg.query(`DELETE FROM media WHERE id = ANY($1::bigint[])`, [mIds])
    : { rowCount: 0 };
  await pg.query('COMMIT');
  log(`↩️  rollback: ${delM.rowCount} media eliminados, ${restored} archivos devueltos`);
  await pg.end();
}

if (a.rollback) {
  await rollback(a.rollback);
  process.exit(0);
}

if (!fs.existsSync(SRC)) throw new Error(`No existe el directorio origen: ${SRC}`);

// ── 1. Inventario ────────────────────────────────────────────────────
const files = fs
  .readdirSync(SRC)
  .filter((f) => MIME[path.extname(f).toLowerCase()])
  .map((f) => {
    const m = f.match(/^(\d+)__(.+)\.(jpe?g|png|webp)$/i);
    if (!m) return { file: f, error: 'nombre no reconocido' };
    return {
      file: f,
      vtexId: m[1],
      slug: m[2],
      ext: `.${m[3].toLowerCase()}`,
      code: `V${m[1]}`,
    };
  });

const malformed = files.filter((f) => f.error);
const valid = files.filter((f) => !f.error);
log(`Origen: ${valid.length} íconos (${malformed.length} con nombre inválido)`);

await pg.connect();

// ── 2. Resolver categorías por código ────────────────────────────────
const codes = [...new Set(valid.map((f) => f.code))];
const rows = (
  await pg.query(
    `SELECT id, code, name, slug, image_media_id
       FROM categories
      WHERE code = ANY($1::text[]) AND parent_id IS NULL AND deleted_at IS NULL`,
    [codes],
  )
).rows;
const byCode = new Map(rows.map((r) => [r.code, r]));

const plan = [];
const problems = [];
for (const f of valid) {
  const cat = byCode.get(f.code);
  if (!cat) {
    problems.push(`${f.file}: no existe categoría raíz ${f.code}`);
    continue;
  }
  // el slug del archivo debe coincidir con el de la categoría (ignorando el sufijo -vN)
  const catSlugBase = String(cat.slug).replace(/-v\d+$/i, '');
  if (catSlugBase !== f.slug) {
    problems.push(`${f.file}: slug "${f.slug}" ≠ categoría "${catSlugBase}"`);
    continue;
  }
  const fileName = `${f.slug}${f.ext}`;
  const dst = path.join(DEST_ROOT, String(cat.id), fileName);
  if (fs.existsSync(dst)) {
    problems.push(`${f.file}: destino ya existe ${path.relative(ROOT, dst)}`);
    continue;
  }
  plan.push({
    ...f,
    categoryId: Number(cat.id),
    categoryName: cat.name,
    previousMediaId: cat.image_media_id ? Number(cat.image_media_id) : null,
    src: path.join(SRC, f.file),
    dst,
    relDst: path.relative(ROOT, dst),
    fileName,
    publicPath: `/static/media/categories/${cat.id}/${fileName}`,
    mime: MIME[f.ext],
    size: fs.statSync(path.join(SRC, f.file)).size,
  });
}

log(`Vinculables: ${plan.length} · con problema: ${problems.length}`);
if (problems.length) {
  log('\nProblemas:');
  for (const p of problems) log('  ' + p);
}
if (plan.length) {
  log('\nDestinos:');
  for (const p of plan) log(`  ${p.code.padEnd(4)} ${p.categoryName} → ${p.relDst}`);
}

if (!APPLY) {
  log(`\n(dry-run) usa --apply para mover ${plan.length} íconos y asignarlos`);
  await pg.end();
  process.exit(0);
}

// ── 3. Aplicar ───────────────────────────────────────────────────────
const snapshot = { generated_at: new Date().toISOString(), source_dir: SRC, created: [] };

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
        `local:category-icon:${p.code}:${p.slug}`,
        JSON.stringify({
          file: p.fileName,
          original: p.file,
          match: 'category-root-icon',
          source: 'import-category-icons',
          category_code: p.code,
          category_id: p.categoryId,
        }),
      ],
    );
    const mediaId = Number(m.rows[0].id);

    await pg.query(`UPDATE categories SET image_media_id = $1 WHERE id = $2`, [
      mediaId,
      p.categoryId,
    ]);

    snapshot.created.push({
      category_id: p.categoryId,
      category_code: p.code,
      media_id: mediaId,
      previous_media_id: p.previousMediaId,
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

fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));

log(`\n✅ ${snapshot.created.length} íconos asignados`);
log(`   snapshot: ${path.relative(ROOT, SNAPSHOT)}`);

await pg.end();
