/**
 * Crea (o actualiza) las estanterías de una sucursal agrupando TODAS las
 * categorías activas de forma lógica.
 *
 * Regla: se definen "áreas" (estanterías). Por prioridad, cada área reclama el
 * subárbol de sus categorías raíz; una categoría ya reclamada por un área de más
 * prioridad no se reasigna. Los departamentos y las categorías sueltas cubren el
 * catálogo; las internas/no comerciales van a una sola estantería "Internas".
 *
 * Uso:
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-tid1-shelves.cjs --dry
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-tid1-shelves.cjs
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const BRANCH_NAME = process.env.BRANCH_NAME || 'TID Sucursal 1';
const DRY = process.argv.includes('--dry');
const ADMIN = { username: 'qa-seed-admin', password: 'qa-seed-1234' };

// Paleta (misma que el editor del panel).
const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];

/**
 * Áreas en ORDEN de prioridad. `roots` = ids cuya descendencia reclama el área.
 * Los ids van como comentario en el nombre para poder revisarlos.
 */
const AREAS = [
  { code: 'CAR-1', name: 'Carnes', type: 'center', roots: [2048, 2116, 2181, 2180] }, // CARNES(2048)→2114,2115 + PT
  { code: 'PAN-1', name: 'Panadería', type: 'center', roots: [2065, 2109, 2185, 2186] },
  { code: 'CON-1', name: 'Congelados', type: 'wall', roots: [2054, 2182] },
  { code: 'CAF-1', name: 'Cafetería', type: 'center', roots: [2108, 2184] },
  { code: 'ROP-1', name: 'Ropa y Accesorios', type: 'wall', roots: [2037, 2099, 2171] },
  { code: 'HAR-1', name: 'Harinas', type: 'center', roots: [2072, 2140] },
  { code: 'ACC-1', name: 'Accesorios y Vehículos', type: 'wall', roots: [2173, 2038, 2100] },
  { code: 'ANCH-1', name: 'Anchetas', type: 'center', roots: [2044, 2110, 2188] },
  { code: 'CAT401-1', name: 'Categoría 40124', type: 'center', roots: [2107, 2183] },
  { code: 'CARZ-1', name: 'Carros', type: 'wall', roots: [2172] },
  { code: 'CAT-1', name: 'Catering', type: 'center', roots: [2187] },
  { code: 'FAR-1', name: 'Farmacia', type: 'wall', roots: [2028, 2160] },
  { code: 'HOG-1', name: 'Línea Hogar', type: 'center', roots: [2032] },
  { code: 'MAS-1', name: 'Mascotas', type: 'wall', roots: [2033] },
  { code: 'JUG-1', name: 'Juguetería', type: 'center', roots: [2031] },
  { code: 'FER-1', name: 'Ferretería', type: 'wall', roots: [2029] },
  { code: 'JAR-1', name: 'Jardinería', type: 'center', roots: [2030] },
  { code: 'PAP-1', name: 'Papelería', type: 'wall', roots: [2034, 2194] },
  { code: 'TEL-1', name: 'Telefonía', type: 'center', roots: [2036] },
  { code: 'EMP-1', name: 'Empaque', type: 'wall', roots: [2035, 2147, 2148, 2149] },
  { code: 'NOA-1', name: 'No Alimentos', type: 'wall', roots: [2027] },
  { code: 'ALI-1', name: 'Alimentos', type: 'center', roots: [2026] },
  { code: 'PROD-1', name: 'Producción', type: 'center', roots: [2024] },
];

// Categorías internas / no comerciales → una sola estantería.
const INTERNAS = {
  code: 'INT-1',
  name: 'Categorías Internas',
  type: 'center',
  roots: [2023, 2025, 2191, 2193, 2175, 2192, 2161, 2089, 2104, 2179, 2042],
};

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  const branches = await (await fetch(`${API}/picking-admin/branches`)).json().catch(() => []);
  // La API exige token; primero resolvemos la sucursal por DB.
  const branchRow = (
    await db.query('SELECT id, name FROM branches WHERE name = $1 LIMIT 1', [BRANCH_NAME])
  ).rows[0];
  if (!branchRow) throw new Error(`No existe la sucursal "${BRANCH_NAME}"`);
  const branchId = Number(branchRow.id);

  const cats = (
    await db.query(
      `SELECT id, name FROM categories WHERE deleted_at IS NULL AND is_active = true ORDER BY display_order, name`,
    )
  ).rows.map((r) => ({ id: Number(r.id), name: r.name }));
  const nameOf = new Map(cats.map((c) => [c.id, c.name]));
  const valid = new Set(nameOf.keys());

  // Relaciones padre→hijos (solo categorías activas).
  const rel = await db.query(
    `SELECT id, parent_id FROM categories WHERE deleted_at IS NULL AND is_active = true`,
  );
  const childrenOf = new Map();
  for (const r of rel.rows) {
    const p = r.parent_id != null ? Number(r.parent_id) : null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(Number(r.id));
  }

  // Asignación por prioridad: cada área reclama el subárbol de sus raíces.
  const assigned = new Map(); // id -> code
  const assignTree = (rootId, code) => {
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      if (!valid.has(id)) continue;
      if (!assigned.has(id)) assigned.set(id, code);
      for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
    }
  };
  for (const area of [...AREAS, INTERNAS]) {
    for (const root of area.roots) assignTree(root, area.code);
  }
  // GENERAL (#2022) es el contenedor paraguas de los departamentos: no representa
  // un lugar físico, así que se deja sin asignar.
  const UMBRELLA = 2022;
  // Sobrantes (raíces cuyo padre no está activo): a Internas.
  for (const c of cats) {
    if (!assigned.has(c.id) && c.id !== UMBRELLA) assigned.set(c.id, INTERNAS.code);
  }

  const idsByCode = new Map();
  for (const [id, code] of assigned) {
    if (!idsByCode.has(code)) idsByCode.set(code, []);
    idsByCode.get(code).push(id);
  }

  // Plan.
  console.log(`\n== Plan de estanterías para ${branchRow.name} (#${branchId}) ==`);
  const all = [...AREAS, INTERNAS];
  for (const area of all) {
    const ids = (idsByCode.get(area.code) ?? []).sort((a, b) => a - b);
    console.log(`  ${area.code.padEnd(8)} ${area.name.padEnd(24)} ${String(ids.length).padStart(3)} categorías`);
  }
  const totalAssigned = [...assigned.keys()].length;
  console.log(`\nCategorías activas: ${cats.length} · asignadas: ${totalAssigned} · contenedor GENERAL sin asignar`);

  if (process.argv.includes('--verbose')) {
    for (const area of all) {
      const ids = (idsByCode.get(area.code) ?? []).sort((a, b) => a - b);
      console.log(`\n  ── ${area.code} ${area.name} ──`);
      console.log('     ' + ids.map((id) => nameOf.get(id)).join(' | '));
    }
  }

  if (DRY) {
    console.log('\n[dry-run] No se creó nada. Ejecuta sin --dry para aplicar.');
    await db.end();
    return;
  }

  // Admin temporal para usar la API (mismo camino que la UI).
  await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
  const hash = await bcrypt.hash(ADMIN.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'Seed', true, true, true)`,
    [`${ADMIN.username}@qa.local`, ADMIN.username, hash],
  );
  try {
    const login = await (
      await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: ADMIN.username, password: ADMIN.password }),
      })
    ).json();
    const auth = { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' };

    const existing = await (await fetch(`${API}/picking-admin/shelves?branchId=${branchId}`, { headers: auth })).json();
    const byCode = new Map(existing.map((s) => [s.code, s]));

    let created = 0;
    let updated = 0;
    for (let i = 0; i < all.length; i++) {
      const area = all[i];
      const categoryIds = (idsByCode.get(area.code) ?? []).sort((a, b) => a - b);
      const found = byCode.get(area.code);
      if (found) {
        const res = await fetch(`${API}/picking-admin/shelves/${found.id}`, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({ name: area.name, categoryIds }),
        });
        if (!res.ok) throw new Error(`PUT ${area.code}: ${res.status} ${await res.text()}`);
        updated++;
      } else {
        const res = await fetch(`${API}/picking-admin/shelves`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            branchId,
            code: area.code,
            name: area.name,
            type: area.type,
            color: COLORS[i % COLORS.length],
            posX: 0,
            posY: 0,
            rotation: 0,
            categoryIds,
          }),
        });
        if (!res.ok) throw new Error(`POST ${area.code}: ${res.status} ${await res.text()}`);
        created++;
      }
    }

    // Verificación por API.
    const after = await (await fetch(`${API}/picking-admin/shelves?branchId=${branchId}`, { headers: auth })).json();
    console.log(`\n== Aplicado ==`);
    console.log(`  estanterías creadas: ${created} · actualizadas: ${updated}`);
    for (const area of all) {
      const s = after.find((x) => x.code === area.code);
      console.log(`  ${area.code.padEnd(8)} → ${s ? s.categories.length : '??'} categorías asignadas`);
    }
    const areaCodes = new Set(all.map((a) => a.code));
    const covered = new Set(
      after.filter((s) => areaCodes.has(s.code)).flatMap((s) => s.categories.map((c) => c.id)),
    );
    console.log(`  categorías activas cubiertas por las áreas: ${covered.size}/${cats.length} (GENERAL sin asignar)`);
  } finally {
    await db.query('DELETE FROM users WHERE username = $1', [ADMIN.username]);
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
