/**
 * Deja activos en el ecommerce SOLO los productos que existen en el catálogo
 * VTEX (mercaldas.com), o sea los que cruzaron por EAN con el scrape.
 *
 * Contexto: `sync-catalog.mjs` marca `products.is_active` con
 * `TIDSAL.INACTIVO = 'A'`, que en el ERP da 11.568 productos. Pero el sitio
 * VTEX solo publica ~7.800, así que el ecommerce mostraba productos que no
 * están a la venta en la web.
 *
 * "Existe en VTEX" = alguna variante del producto tiene un `barcode` presente
 * en `mercaldas_products.ean` del scrape. Es la misma regla con la que
 * `sync-vtex-categories.mjs` asignó categorías, así que no hay dos verdades.
 *
 * No borra nada: solo pone `is_active = false`. Los productos se pueden
 * reactivar desde el admin o con `--rollback`.
 *
 * Uso:
 *   node scripts-agent/erp/web-catalog-only.mjs              # dry-run
 *   node scripts-agent/erp/web-catalog-only.mjs --apply
 *   node scripts-agent/erp/web-catalog-only.mjs --rollback=db/backups/web-catalog-<ts>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPg } from './openads.mjs';
import { args, log, ROOT } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const SQLITE =
  a.sqlite || '/home/jk/Proyectos/seeds/Vassago/web_scraper/db/traffic.db';

const pg = createPg();
await pg.connect();
const q = (t, p) => pg.query(t, p);

// ── Rollback ───────────────────────────────────────────────────
if (a.rollback) {
  const file = path.isAbsolute(a.rollback)
    ? a.rollback
    : path.join(ROOT, a.rollback);
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  await q("SET app.erp_sync = 'on'");
  const res = await q(
    'UPDATE products SET is_active = true, updated_at = now() WHERE id = ANY($1::bigint[])',
    [snap.deactivated.map((p) => p.id)],
  );
  log(`↩️  Rollback: ${res.rowCount} productos reactivados desde ${a.rollback}`);
  await pg.end();
  process.exit(0);
}

// ── Universo VTEX: EAN del scrape ──────────────────────────────
log(`⏳ Leyendo EAN del scrape: ${SQLITE}`);
const sqlite = new DatabaseSync(SQLITE, { readOnly: true });
const vtexEans = new Set(
  sqlite
    .prepare("SELECT DISTINCT ean FROM mercaldas_products WHERE ean IS NOT NULL AND trim(ean) <> ''")
    .all()
    .map((r) => String(r.ean).trim()),
);
sqlite.close();
log(`   ${vtexEans.size} EAN distintos en el scrape`);

const variants = (
  await q(
    "SELECT product_id, barcode FROM product_variants WHERE barcode IS NOT NULL AND barcode <> ''",
  )
).rows;

const enVtex = new Set();
for (const v of variants) {
  if (vtexEans.has(String(v.barcode).trim())) enVtex.add(Number(v.product_id));
}

const activos = (
  await q(
    `SELECT p.id, p.name, p.is_public
       FROM products p
      WHERE p.is_active AND p.deleted_at IS NULL
      ORDER BY p.name`,
  )
).rows;

const bajar = activos.filter((p) => !enVtex.has(Number(p.id)));

log(`\n📊 Productos activos hoy: ${activos.length}`);
log(`   en catálogo VTEX (se quedan): ${activos.length - bajar.length}`);
log(`   fuera de VTEX (se desactivan): ${bajar.length}`);

if (!APPLY) {
  log('\n🧪 DRY-RUN — nada escrito. Usa --apply para aplicar.');
  for (const p of bajar.slice(0, 15)) log(`     ${p.id} ${p.name}`);
  if (bajar.length > 15) log(`     … y ${bajar.length - 15} más`);
  await pg.end();
  process.exit(0);
}

const ts = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+/, '')
  .replace('T', '-');
const dir = path.join(ROOT, 'db/backups');
fs.mkdirSync(dir, { recursive: true });
const snapFile = path.join(dir, `web-catalog-${ts}.json`);
fs.writeFileSync(
  snapFile,
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      motivo: 'Dejar activos solo los productos publicados en VTEX',
      regla: 'product_variants.barcode ∈ mercaldas_products.ean',
      deactivated: bajar.map((p) => ({ id: Number(p.id), name: p.name })),
    },
    null,
    2,
  ),
);
log(`\n💾 Snapshot: ${path.relative(ROOT, snapFile)}`);

// `app.erp_sync = 'on'`: no empujar el cambio a Advantage; el ERP sigue
// mandando su propio INACTIVO y esto es una decisión editorial de la web.
await q("SET app.erp_sync = 'on'");
const res = await q(
  `UPDATE products SET is_active = false, updated_at = now()
    WHERE id = ANY($1::bigint[]) AND is_active`,
  [bajar.map((p) => Number(p.id))],
);
log(`✅ ${res.rowCount} productos desactivados`);

const after = (
  await q(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE is_public)::int AS publicos
       FROM products WHERE is_active AND deleted_at IS NULL`,
  )
).rows[0];
log(`📊 Activos ahora: ${after.n} (${after.publicos} con is_public)`);

await pg.end();
