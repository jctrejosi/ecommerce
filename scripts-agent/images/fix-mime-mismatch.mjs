/**
 * Corrige un archivo importado cuya extensión no coincide con su contenido real
 * (PNG guardado como .jpg): renombra el archivo, actualiza `media` y el snapshot.
 *
 * Uso: node scripts-agent/images/fix-mime-mismatch.mjs <productId> <archivoActual> <nuevaExt>
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from '../erp/openads.mjs';
import { ROOT, log } from '../erp/lib.mjs';

const [productId, current, newExt] = process.argv.slice(2);
if (!productId || !current || !newExt) {
  throw new Error('uso: <productId> <archivoActual> <nuevaExt>');
}

const dir = path.join(ROOT, 'db/images_static/media/products', productId);
const srcAbs = path.join(dir, current);
const base = path.basename(current, path.extname(current));
const nextName = `${base}.${newExt.replace(/^\./, '')}`;
const dstAbs = path.join(dir, nextName);

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const mime = MIME[newExt.replace(/^\./, '').toLowerCase()];
if (!mime) throw new Error(`extensión no soportada: ${newExt}`);
if (fs.existsSync(srcAbs)) {
  fs.renameSync(srcAbs, dstAbs);
} else if (!fs.existsSync(dstAbs)) {
  throw new Error(`no existe ${srcAbs} ni ${dstAbs}`);
}
const oldPath = `/static/media/products/${productId}/${current}`;
const newPath = `/static/media/products/${productId}/${nextName}`;

const pg = createPg();
await pg.connect();
await pg.query('BEGIN');
await pg.query(`SET LOCAL app.erp_sync = 'on'`);
const r = await pg.query(
  `UPDATE media
      SET path = $1,
          file_name = $2::varchar,
          mime_type = $3,
          metadata = metadata || jsonb_build_object('file', $2::text, 'mime_fixed', true),
          -- $2 se usa también como varchar arriba; el cast explícito evita 42P08
          updated_at = now()
    WHERE path = $4
    RETURNING id`,
  [newPath, nextName, mime, oldPath],
);
await pg.query('COMMIT');
if (!r.rowCount) throw new Error(`no se encontró media con path ${oldPath}`);

// actualizar snapshots que referencien la ruta anterior
const backupDir = path.join(ROOT, 'db/backups');
for (const f of fs.readdirSync(backupDir)) {
  if (!f.startsWith('import-scraped-images-') || !f.endsWith('.json')) continue;
  const file = path.join(backupDir, f);
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  let touched = false;
  for (const c of snap.created ?? []) {
    if (c.path === oldPath) {
      c.dst = dstAbs;
      c.path = newPath;
      touched = true;
    }
  }
  if (touched) fs.writeFileSync(file, JSON.stringify(snap, null, 2));
}

log(`✅ ${oldPath} → ${newPath} (media #${r.rows[0].id}, ${mime})`);
await pg.end();
