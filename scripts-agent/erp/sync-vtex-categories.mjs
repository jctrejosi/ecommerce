/**
 * Sincroniza el árbol de categorías del scrape VTEX (mercaldas.com) → categories
 * (Postgres) y reasigna los productos cruzados por EAN a su categoría primaria
 * VTEX.
 *
 * Fuente: SQLite del scraper (`mercaldas_categories`, `mercaldas_products`).
 * Destino: `categories` + `product_categories` de Postgres.
 *
 * Reglas:
 *   - Las categorías VTEX se insertan con `code = 'V' + id` para no chocar con
 *     los códigos numéricos de TIDTAB.
 *   - El árbol es de 3 niveles (depth 0/1/2).
 *   - Sólo se reasignan los productos que YA cruzamos por código de barras
 *     (`mercaldas_products.ean` = `product_variants.barcode`).
 *   - Los productos sin match NO se tocan: siguen en su categoría actual.
 *   - No se borra ni desactiva el árbol viejo (TIDTAB).
 *
 * Uso:
 *   node scripts-agent/erp/sync-vtex-categories.mjs                 # dry-run
 *   node scripts-agent/erp/sync-vtex-categories.mjs --apply
 *   node scripts-agent/erp/sync-vtex-categories.mjs --sqlite=/ruta/traffic.db
 */
import { DatabaseSync } from 'node:sqlite';
import { createPg } from './openads.mjs';
import { args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const SQLITE = a.sqlite || '/home/jk/Proyectos/seeds/Vassago/web_scraper/db/traffic.db';

const slugify = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

// ── 1. Leer el scrape ──────────────────────────────────────────
log(`⏳ Leyendo scrape VTEX: ${SQLITE}`);
const db = new DatabaseSync(SQLITE);
const vtexCats = db
  .prepare('SELECT id, name, parent_id, depth, path FROM mercaldas_categories ORDER BY depth, id')
  .all();
const vtexProds = db
  .prepare('SELECT ean, primary_category_id FROM mercaldas_products WHERE primary_category_id IS NOT NULL')
  .all();
db.close();
log(`   ${vtexCats.length} categorías · ${vtexProds.length} productos con categoría`);

const pg = createPg();
await pg.connect();
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

// ── 2. Árbol VTEX → categories ─────────────────────────────────
const pgIdByVtexId = new Map();
const created = [];
const updated = [];

for (const c of vtexCats) {
  const code = `V${c.id}`;
  const slug = `${slugify(c.name) || 'cat'}-v${c.id}`.slice(0, 100);
  const parentId = c.parent_id ? pgIdByVtexId.get(c.parent_id) ?? null : null;

  if (!APPLY) {
    // En dry-run no escribimos; sólo simulamos un id para resolver parents.
    pgIdByVtexId.set(c.id, -c.id);
    created.push({ code, name: c.name });
    continue;
  }

  const existing = await q(
    'SELECT id FROM categories WHERE code = $1 AND deleted_at IS NULL',
    [code],
  );
  const row = (
    await q(
      `INSERT INTO categories (parent_id, name, slug, code, level, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (code) WHERE (code IS NOT NULL AND deleted_at IS NULL)
       DO UPDATE SET parent_id = EXCLUDED.parent_id, name = EXCLUDED.name,
                     level = EXCLUDED.level, is_active = true
       RETURNING id`,
      [parentId, String(c.name).slice(0, 100), slug, code, c.depth],
    )
  ).rows[0];
  pgIdByVtexId.set(c.id, Number(row.id));
  if (existing.rowCount) updated.push({ code, name: c.name });
  else created.push({ code, name: c.name });
}

log(
  `${APPLY ? '✅' : '🧪'} Árbol VTEX: ${created.length} nuevas · ${updated.length} actualizadas${APPLY ? '' : ' (dry-run)'}`,
);

// ── 3. Productos: EAN → categoría VTEX ─────────────────────────
const catByEan = new Map();
for (const p of vtexProds) {
  const ean = String(p.ean ?? '').trim();
  if (ean) catByEan.set(ean, Number(p.primary_category_id));
}

const variants = (
  await q(
    "SELECT barcode, product_id FROM product_variants WHERE barcode IS NOT NULL AND barcode <> ''",
  )
).rows;

const catIdByProduct = new Map(); // product_id -> vtex category pg id
let matched = 0;
let noCatInTree = 0;
for (const v of variants) {
  const vtexCat = catByEan.get(String(v.barcode).trim());
  if (vtexCat == null) continue;
  const pgCat = pgIdByVtexId.get(vtexCat);
  if (!pgCat) {
    noCatInTree++;
    continue;
  }
  const pid = Number(v.product_id);
  if (!catIdByProduct.has(pid)) {
    catIdByProduct.set(pid, pgCat);
    matched++;
  }
}

log(`   productos con EAN y categoría VTEX: ${matched}${noCatInTree ? ` (${noCatInTree} variantes sin categoría en árbol)` : ''}`);

if (APPLY) {
  const ids = [...catIdByProduct.keys()];
  log('⏳ Reemplazando product_categories de los productos cruzados…');
  const CHUNK = 1000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await q('DELETE FROM product_categories WHERE product_id = ANY($1::bigint[])', [chunk]);
  }
  // Insertar por lotes
  const rows = [...catIdByProduct.entries()];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map(([pid, cid]) => `($${params.push(pid)},$${params.push(cid)})`);
    await q(
      `INSERT INTO product_categories (product_id, category_id) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`,
      params,
    );
  }
  log(`   ${rows.length} productos reasignados a categorías VTEX`);
} else {
  log('\n🧪 DRY-RUN — nada escrito. Usa --apply para escribir.');
  log('   Raíces VTEX:');
  for (const c of vtexCats.filter((c) => c.depth === 0).slice(0, 30)) log(`     V${c.id} → ${c.name}`);
}

await pg.end();
