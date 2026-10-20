/*
 * E2E: /picking-admin/categories?branchId= devuelve solo las categorías con
 * productos en el surtido de esa sucursal, con su conteo por sucursal.
 */
const { Client } = require('pg');
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };
const API = 'http://localhost:3000';

const get = async (path) => {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
};

(async () => {
  const db = new Client(DB);
  await db.connect();

  const all = await get('/picking-admin/categories');
  console.log(`sin sucursal: HTTP ${all.status}, ${all.body?.length} categorías (global)`);

  for (const b of [9, 10, 11]) {
    const r = await get(`/picking-admin/categories?branchId=${b}`);
    const list = r.body ?? [];
    const dbCount = await db.query(
      `SELECT COUNT(DISTINCT pc.category_id)::int AS n
         FROM product_categories pc
         JOIN product_variants pv ON pv.product_id = pc.product_id
         JOIN inventory i ON i.product_variant_id = pv.id AND i.branch_id = $1 AND i.stock > 0`,
      [b],
    );
    const zero = list.filter((c) => c.productCount === 0).length;
    console.log(`branch ${b}: HTTP ${r.status}, ${list.length} categorías (BD=${dbCount.rows[0].n}), con productCount=0: ${zero}`);
  }

  // La primera categoría de la sucursal 9 debe traer su conteo de sucursal.
  const b9 = (await get('/picking-admin/categories?branchId=9')).body ?? [];
  console.log(`\nEjemplo branch 9: "${b9[0]?.name}" -> ${b9[0]?.productCount} productos (sucursal)`);

  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
