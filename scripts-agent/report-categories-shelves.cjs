/**
 * Reporte para planear las estanterías de una sucursal a partir de las categorías.
 *
 * No vuelca todo al chat: imprime sucursales, totales, el árbol completo a un
 * archivo y un resumen de las categorías raíz (con nº de descendientes y productos).
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/report-categories-shelves.cjs [branchId]
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const fs = require('node:fs');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');

const BRANCH_ID = process.argv[2] ? Number(process.argv[2]) : null;

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  const branches = await db.query(
    'SELECT id, code, name, is_active FROM branches ORDER BY priority, name',
  );
  console.log('== Sucursales ==');
  for (const b of branches.rows) {
    console.log(`  #${b.id} [${b.code}] ${b.name}${b.is_active ? '' : ' (inactiva)'}`);
  }

  const target = BRANCH_ID ?? branches.rows.find((b) => /TID.*Sucursal 1$|Sucursal 1$/i.test(b.name))?.id;
  const branch = branches.rows.find((b) => Number(b.id) === Number(target));
  console.log(`\n== Objetivo: #${branch?.id} ${branch?.name} ==`);

  const cats = await db.query(
    `SELECT id, name, parent_id, level
       FROM categories
      WHERE deleted_at IS NULL AND is_active = true
      ORDER BY display_order, name`,
  );
  console.log(`\nCategorías activas: ${cats.rows.length}`);

  // Productos por categoría (para priorizar dónde hay inventario).
  const counts = await db.query(
    `SELECT category_id, count(*)::int AS n FROM product_categories GROUP BY category_id`,
  );
  const countBy = new Map(counts.rows.map((r) => [Number(r.category_id), r.n]));

  const byId = new Map(cats.rows.map((c) => [Number(c.id), { ...c, id: Number(c.id) }]));
  const childrenOf = new Map();
  for (const c of byId.values()) {
    const p = c.parent_id != null ? Number(c.parent_id) : null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(c.id);
  }
  const descendants = (id) => {
    let n = 0;
    for (const ch of childrenOf.get(id) ?? []) n += 1 + descendants(ch);
    return n;
  };
  const productsUnder = (id) => (countBy.get(id) ?? 0) + (childrenOf.get(id) ?? []).reduce((a, ch) => a + productsUnder(ch), 0);

  const roots = childrenOf.get(null) ?? [];
  console.log(`\n== Categorías raíz (${roots.length}) ==`);
  for (const id of roots) {
    const c = byId.get(id);
    console.log(`  «${c.name}» (#${id}) · ${descendants(id)} hijas · ${productsUnder(id)} productos`);
  }

  // Árbol completo a un archivo (para revisar sin llenar el chat).
  const out = [];
  const walk = (id, depth) => {
    const c = byId.get(id);
    out.push(`${'  '.repeat(depth)}- ${c.name} (#${id}) [${countBy.get(id) ?? 0} prod]`);
    for (const ch of childrenOf.get(id) ?? []) walk(ch, depth + 1);
  };
  for (const id of roots) walk(id, 0);
  const file = 'scripts-agent/.scratch/categories-tree.txt';
  fs.mkdirSync('scripts-agent/.scratch', { recursive: true });
  fs.writeFileSync(file, out.join('\n'));
  console.log(`\nÁrbol completo: ${file} (${out.length} líneas)`);

  // Estanterías actuales de la sucursal.
  if (branch) {
    const shelves = await db.query(
      `SELECT id, code, name FROM shelves WHERE branch_id = $1 ORDER BY code`,
      [branch.id],
    );
    console.log(`\n== Estanterías actuales de ${branch.name} (${shelves.rows.length}) ==`);
    for (const s of shelves.rows) console.log(`  #${s.id} ${s.code} — ${s.name}`);
  }

  await db.end();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
