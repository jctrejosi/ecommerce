/**
 * Siembra estanterías de ejemplo para TODAS las sucursales activas, para poder
 * verlas en el admin de picking (Estanterías, Mapa y Categorías).
 *
 * Es idempotente: usa códigos `DEMO-1..N` y omite los que ya existan en cada
 * sucursal, así que se puede volver a correr sin duplicar.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/seed-demo-shelves.cjs
 */
const API = process.env.API_URL || 'http://127.0.0.1:3000';

/** Cuántas estanterías de ejemplo por sucursal. */
const PER_BRANCH = 3;
const COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6'];

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, payload };
}

async function main() {
  const branches = await getJson('/picking-admin/branches');
  const categories = await getJson('/picking-admin/categories');
  if (!branches.length) throw new Error('No hay sucursales activas');

  console.log(`Sucursales activas: ${branches.length}`);
  console.log(`Categorías disponibles: ${categories.length}`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let b = 0; b < branches.length; b++) {
    const branch = branches[b];
    const existing = await getJson(`/picking-admin/shelves?branchId=${branch.id}`);
    const usedCodes = new Set(existing.map((s) => s.code));
    console.log(`\n# Sucursal ${branch.name} (id ${branch.id}) — ya tiene ${existing.length}`);

    for (let i = 0; i < PER_BRANCH; i++) {
      const code = `DEMO-${i + 1}`;
      if (usedCodes.has(code)) {
        skipped++;
        continue;
      }

      // Reparte las categorías entre las estanterías (rotando por sucursal).
      const category = categories.length
        ? categories[(b * PER_BRANCH + i) % categories.length]
        : null;
      const color = COLORS[(b + i) % COLORS.length];
      const type = i % 2 === 0 ? 'center' : 'wall';

      const { ok, status, payload } = await postJson('/picking-admin/shelves', {
        branchId: branch.id,
        code,
        name: `Estantería demo ${i + 1}`,
        type,
        color,
        // Dimensiones en celdas del mapa.
        width: type === 'wall' ? 2 : 3,
        height: type === 'wall' ? 5 : 2,
        posX: 4 + i * 7,
        posY: 4 + (b % 3) * 8,
        rotation: 0,
        categoryId: category?.id ?? null,
        rows: [
          { rowNumber: 1, label: 'Fila 1 (arriba)' },
          { rowNumber: 2, label: 'Fila 2 (centro)' },
          { rowNumber: 3, label: 'Fila 3 (abajo)' },
        ],
      });

      if (ok) {
        created++;
        console.log(
          `  ok  ${code} · ${category ? category.name : 'sin categoría'} · ${type}`,
        );
      } else {
        failed++;
        console.log(`  FALLA ${code} → HTTP ${status}: ${payload?.message ?? ''}`);
      }
    }
  }

  console.log(`\n== Resumen: ${created} creadas · ${skipped} ya existían · ${failed} con error ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
