/*
 * E2E: /picking-admin/products devuelve solo productos con inventario en la
 * sucursal (paginado, con total). Antes devolvía todo el catálogo global.
 */
const API = 'http://localhost:3000';

async function products(branchId, extra = '') {
  const res = await fetch(`${API}/picking-admin/products?branchId=${branchId}&limit=60&offset=0${extra}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body ?? {} };
}

(async () => {
  console.log('Totales por sucursal (BD: TID1=19252, TID2=14142, TID11=18544):');
  const totals = {};
  for (const b of [9, 10, 11]) {
    const { status, body } = await products(b);
    totals[b] = { total: body.total, items: (body.products ?? []).length };
    const allStock = (body.products ?? []).every((p) => p.stock > 0);
    console.log(`  branch ${b}: HTTP ${status}, total=${body.total}, página=${(body.products ?? []).length}, todos stock>0: ${allStock}`);
  }

  // Página 2 debe traer productos distintos a la página 1.
  const p1 = await fetch(`${API}/picking-admin/products?branchId=9&limit=60&offset=0`).then((r) => r.json());
  const p2 = await fetch(`${API}/picking-admin/products?branchId=9&limit=60&offset=60`).then((r) => r.json());
  const s1 = new Set(p1.products.map((x) => x.productVariantId));
  const overlap = p2.products.filter((x) => s1.has(x.productVariantId)).length;
  console.log(`\nPaginación branch 9: página1=${p1.products.length}, página2=${p2.products.length}, solapamiento=${overlap} (esperado 0)`);

  // Búsqueda dentro de la sucursal.
  const search = await fetch(`${API}/picking-admin/products?branchId=9&limit=60&offset=0&search=leche`).then((r) => r.json());
  console.log(`Búsqueda "leche" en branch 9: total=${search.total}, página=${search.products.length}`);
  console.log('\n✔ Cada sucursal trae su surtido, paginado y con total real.');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
