/**
 * Deja el árbol de categorías de Postgres EXACTAMENTE como el de VTEX
 * (mercaldas.com), que es el que ya se cargó con `sync-vtex-categories.mjs`.
 *
 * Problema que resuelve: además de las 484 categorías VTEX ('V' + id), la tabla
 * `categories` tiene ~231 categorías contables del ERP (TIDTAB) que también son
 * `level = 0`. `GET /catalog/categories` devuelve todas las activas, así que el
 * header de la tienda mostraba 89 raíces (18 VTEX + ~71 del ERP) mezcladas.
 *
 * Qué hace:
 *   1. Desactiva (`is_active = false`) toda categoría que NO sea VTEX.
 *      No borra nada y no toca el ERP (`app.erp_sync = 'on'` evita el outbox).
 *   2. A los productos ACTIVOS que quedarían sin ninguna categoría VTEX les
 *      asigna la raíz VTEX equivalente, por el nombre de su categoría vieja.
 *      Si no hay equivalencia → "Otros" (V592). No borra `product_categories`
 *      viejas: quedan como histórico inerte (las categorías están inactivas).
 *   3. Guarda un snapshot en `db/backups/categories-vtex-<ts>.json` para poder
 *      revertir con `--rollback=<archivo>`.
 *
 * Uso:
 *   node scripts-agent/erp/vtex-tree-only.mjs                  # dry-run
 *   node scripts-agent/erp/vtex-tree-only.mjs --apply
 *   node scripts-agent/erp/vtex-tree-only.mjs --apply --no-orphans
 *   node scripts-agent/erp/vtex-tree-only.mjs --rollback=db/backups/categories-vtex-20261028-120000.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPg } from './openads.mjs';
import { args, log, ROOT } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const ASSIGN_ORPHANS = !a['no-orphans'];

const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/**
 * Crosswalk nombre-categoría-ERP → raíz VTEX (id VTEX del scrape).
 * Sólo aplica a productos que NO cruzaron por EAN con el scrape: sirve para
 * que no desaparezcan de los filtros, no para "adivinar" la categoría fina.
 */
const CROSSWALK = {
  12: [
    'USO PERSONAL',
    'HIGIENE ORAL',
    'HIGIENE INTIMA',
    'BOTIQUIN',
    'FARMACIA',
  ],
  674: ['JUGUETERIA'],
  4: ['FRUVER'],
  10: ['MASCOTAS'],
  7: [
    'CONGELADOS',
    'LACTEOS',
    'REFRIGERADOS',
    'MODIFICADORES DE LECHE',
    'HUEVOS',
  ],
  8: ['LICORES'],
  3: [
    'CHARCUTERIA',
    'CARNES PROC P.T.',
    'CARNES PROC M.P.',
    'CARNES PROCESADAS',
  ],
  2: ['CARNE EN CORTES P.T.', 'CARNE EN CANAL M.P.'],
  1: ['ELECTRODOMESTICOS Y GASODOMESTICOS'],
  6: [
    'DULCERIA-PASABOCAS',
    'DULCERIA',
    'PANADERIA MERCALDAS PRODUCTO TERMINADO',
    'PANADERIA MERCALDAS MATERIA PRIMA',
    'PANADERIA',
    'REFRESCOS',
    'ADEREZOS-SALSAS',
    'ENLATADOS',
    'CIGARRILLOS-ENCENDEDORES',
    'REPOSTERIA',
    'TE-TISANAS',
    'GRASAS',
    'CONDIMENTOS',
    'GRANO',
    'COMPLEMENTOS ALIMENTICIOS',
    'CAFE',
    'ALIMENTOS',
    'PASTAS ALIMENTICIAS',
    'PRODUCTOS CATERING',
    'CEREALES',
    'SOPAS-CALDOS-BASES',
    'CHOCOLATES',
    'ENDULZANTES',
    'HARINAS',
    'CAFETERIA',
    // El nombre viejo miente (acá hay yogurt, sal, refrescos), pero el
    // muestreo de estos códigos es mayoritariamente abarrotes.
    'GENERAL',
    'EMPAQUE',
  ],
  11: ['ASEO PISOS', 'ASEO COCINA-HOGAR', 'ASEO ROPA', 'ASEO BAÑOS'],
  594: [
    'ACCESORIOS HOGAR',
    'JARDINERIA',
    'DESECHABLES',
    'LINEA HOGAR',
    'CARROS',
    'BOLSA REUTILIZABLE',
  ],
  621: ['ROPA Y ACCESORIOS'],
  655: ['SUSCRIPCION TELEVISION', 'TELEFONIA MOVIL'],
  711: ['FERRETERIA'],
  9: ['INFANTIL', 'INFANTIL-ALIMENTOS'],
  // Catch-all explícito: sin equivalencia clara → "Otros".
  592: [
    'PAPELERIA',
    'NO ALIMENTOS',
    'ANCHETAS MERCALDAS',
    'TARJETA REGALO MERCALDAS',
    'VEHICULOS',
    'DOMICILIOS',
  ],
};
const FALLBACK_VTEX_ID = 592;

const nameToVtexId = new Map();
for (const [vtexId, names] of Object.entries(CROSSWALK)) {
  for (const n of names) nameToVtexId.set(norm(n), Number(vtexId));
}

const VTEX_CODE = "code ~ '^V[0-9]+$'";
const NOT_VTEX = '(code IS NULL OR code !~ \'^V[0-9]+$\')';

const pg = createPg();
await pg.connect();
const q = (t, p) => pg.query(t, p);

// ── Rollback ───────────────────────────────────────────────────
if (a.rollback) {
  const file = path.isAbsolute(a.rollback)
    ? a.rollback
    : path.join(ROOT, a.rollback);
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  log(`↩️  Rollback desde ${file}`);
  await q("SET app.erp_sync = 'on'");
  await q('BEGIN');
  try {
    if (snap.deactivated?.length) {
      await q(
        'UPDATE categories SET is_active = true WHERE id = ANY($1::bigint[])',
        [snap.deactivated.map((c) => c.id)],
      );
    }
    if (snap.assigned?.length) {
      const CHUNK = 1000;
      for (let i = 0; i < snap.assigned.length; i += CHUNK) {
        const chunk = snap.assigned.slice(i, i + CHUNK);
        await q(
          `DELETE FROM product_categories pc
             USING unnest($1::bigint[], $2::bigint[]) AS x(pid, cid)
            WHERE pc.product_id = x.pid AND pc.category_id = x.cid`,
          [chunk.map((r) => r.product_id), chunk.map((r) => r.category_id)],
        );
      }
    }
    await q('COMMIT');
    log(
      `✅ Rollback: ${snap.deactivated?.length ?? 0} categorías reactivadas · ${snap.assigned?.length ?? 0} asignaciones eliminadas`,
    );
  } catch (e) {
    await q('ROLLBACK');
    throw e;
  }
  await pg.end();
  process.exit(0);
}

// ── Diagnóstico ────────────────────────────────────────────────
const stats = (
  await q(`
    SELECT
      count(*) FILTER (WHERE ${VTEX_CODE}) AS vtex,
      count(*) FILTER (WHERE ${NOT_VTEX} AND is_active) AS otras_activas,
      count(*) FILTER (WHERE ${NOT_VTEX}) AS otras_total
      FROM categories WHERE deleted_at IS NULL
  `)
).rows[0];

log(
  `📊 Categorías: ${stats.vtex} VTEX · ${stats.otras_activas} ERP activas de ${stats.otras_total}`,
);

const oldCats = (
  await q(
    `SELECT id, code, name FROM categories
      WHERE deleted_at IS NULL AND ${NOT_VTEX} AND is_active
      ORDER BY name`,
  )
).rows;

if (oldCats.length === 0) {
  log('✅ No hay categorías no-VTEX activas. Nada que desactivar.');
}

// Productos activos que quedarían sin categoría VTEX.
const orphans = (
  await q(`
    SELECT p.id, p.name,
           array_remove(array_agg(DISTINCT c.name), NULL) AS cat_names
      FROM products p
      LEFT JOIN product_categories pc ON pc.product_id = p.id
      LEFT JOIN categories c ON c.id = pc.category_id
     WHERE p.is_active AND p.deleted_at IS NULL
       AND p.id NOT IN (
         SELECT pc2.product_id
           FROM product_categories pc2
           JOIN categories c2 ON c2.id = pc2.category_id
          WHERE c2.code ~ '^V[0-9]+$'
       )
     GROUP BY p.id, p.name
  `)
).rows;

const vtexRootIds = new Map(
  (
    await q(
      `SELECT code, id FROM categories
        WHERE deleted_at IS NULL AND ${VTEX_CODE} AND level = 0`,
    )
  ).rows.map((r) => [Number(String(r.code).slice(1)), Number(r.id)]),
);

const plan = new Map(); // vtexId -> [{product_id, category_id, via}]
let sinEquivalencia = 0;
for (const p of orphans) {
  const names = (p.cat_names ?? []).filter(Boolean);
  let vtexId = null;
  let via = null;
  for (const n of names) {
    const hit = nameToVtexId.get(norm(n));
    if (hit != null) {
      vtexId = hit;
      via = n;
      break;
    }
  }
  if (vtexId == null) {
    vtexId = FALLBACK_VTEX_ID;
    via = names.length ? `sin equivalencia (${names.join(', ')})` : 'sin categoría';
    sinEquivalencia++;
  }
  const pgCat = vtexRootIds.get(vtexId);
  if (!pgCat) {
    log(`⚠️  Falta la categoría VTEX V${vtexId} en Postgres; se omite el producto ${p.id}`);
    continue;
  }
  const list = plan.get(vtexId) ?? [];
  list.push({ product_id: Number(p.id), category_id: pgCat, via });
  plan.set(vtexId, list);
}

const totalAssign = [...plan.values()].reduce((n, l) => n + l.length, 0);

log(`\n🧩 Productos activos sin categoría VTEX: ${orphans.length}`);
log(`   se asignarían ${totalAssign} (${sinEquivalencia} a "Otros"/V${FALLBACK_VTEX_ID})`);
for (const [vtexId, list] of [...plan.entries()].sort((x, y) => y[1].length - x[1].length)) {
  const name = (
    await q('SELECT name FROM categories WHERE id = $1', [list[0].category_id])
  ).rows[0]?.name;
  log(`     V${vtexId} ${name}: ${list.length}`);
}

if (!APPLY) {
  log('\n🧪 DRY-RUN — nada escrito. Usa --apply para aplicar.');
  log(`   Categorías a desactivar: ${oldCats.length}`);
  for (const c of oldCats.slice(0, 12)) log(`     ${c.code ?? '(sin code)'} ${c.name}`);
  if (oldCats.length > 12) log(`     … y ${oldCats.length - 12} más`);
  await pg.end();
  process.exit(0);
}

// ── Aplicar ────────────────────────────────────────────────────
const ts = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+/, '')
  .replace('T', '-');
const snapDir = path.join(ROOT, 'db/backups');
fs.mkdirSync(snapDir, { recursive: true });
const snapFile = path.join(snapDir, `categories-vtex-${ts}.json`);

const assigned = [];
for (const list of plan.values()) {
  for (const r of list) assigned.push({ product_id: r.product_id, category_id: r.category_id });
}

fs.writeFileSync(
  snapFile,
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      motivo: 'Dejar el árbol de categorías igual a VTEX',
      deactivated: oldCats.map((c) => ({ id: Number(c.id), code: c.code, name: c.name })),
      assigned,
    },
    null,
    2,
  ),
);
log(`\n💾 Snapshot: ${path.relative(ROOT, snapFile)}`);

await q("SET app.erp_sync = 'on'");
await q('BEGIN');
try {
  if (oldCats.length) {
    const del = await q(
      `UPDATE categories SET is_active = false, updated_at = now()
        WHERE id = ANY($1::bigint[]) AND is_active`,
      [oldCats.map((c) => Number(c.id))],
    );
    log(`✅ Desactivadas ${del.rowCount} categorías no-VTEX`);
  }

  if (ASSIGN_ORPHANS && assigned.length) {
    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < assigned.length; i += CHUNK) {
      const chunk = assigned.slice(i, i + CHUNK);
      const params = [];
      const tuples = chunk.map(
        (r) => `($${params.push(r.product_id)},$${params.push(r.category_id)})`,
      );
      const ins = await q(
        `INSERT INTO product_categories (product_id, category_id)
         VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`,
        params,
      );
      inserted += ins.rowCount;
    }
    log(`✅ ${inserted} asignaciones producto→categoría VTEX creadas`);
  } else if (!ASSIGN_ORPHANS) {
    log('ℹ️  --no-orphans: se dejan los productos sin categoría VTEX.');
  }

  await q('COMMIT');
} catch (e) {
  await q('ROLLBACK');
  throw e;
}

// ── Verificación ───────────────────────────────────────────────
const after = (
  await q(`
    SELECT
      count(*) FILTER (WHERE ${VTEX_CODE} AND is_active) AS vtex_activas,
      count(*) FILTER (WHERE ${NOT_VTEX} AND is_active) AS otras_activas
      FROM categories WHERE deleted_at IS NULL
  `)
).rows[0];
log(
  `\n📊 Después: ${after.vtex_activas} activas VTEX · ${after.otras_activas} activas no-VTEX`,
);

await pg.end();
