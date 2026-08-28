// Crea estanterías de ejemplo por sucursal y asigna una ubicación ALEATORIA
// (determinista) a todos los productos (variantes) de cada sucursal.
//
// Uso:
//   DATABASE_URL='...' DB_SSL=true node scripts/seed-shelves.js
//   WIPE=1 DATABASE_URL='...' DB_SSL=true node scripts/seed-shelves.js   # borra y recrea todo
//
// La semilla del RNG es FIJA: si local y producción parten del mismo estado
// (mismos productos y sucursales), el resultado es idéntico en ambos.
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida');
  process.exit(1);
}

const WIPE = process.env.WIPE === '1';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 4,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// RNG determinista (mulberry32) — misma semilla en local y producción
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RNG = mulberry32(20260828);

// Estanterías de ejemplo (mismas para todas las sucursales, en este orden).
// Posiciones pensadas para la rejilla 14×28 del mapa de la bodega.
const EXAMPLE_SHELVES = [
  { code: 'A1', name: 'Lácteos', type: 'wall', color: '#3B82F6', x: 0, y: 0, rows: ['Leche y bebidas lácteas', 'Quesos frescos', 'Mantequilla / crema', 'Yogurt bebible', 'Kumis y avena'] },
  { code: 'A2', name: 'Bebidas', type: 'wall', color: '#A855F7', x: 5, y: 0, rows: ['Jugos naturales', 'Jugos industriales', 'Gaseosas', 'Energéticas', 'Aguas aromáticas'] },
  { code: 'A3', name: 'Panadería', type: 'wall', color: '#F97316', x: 10, y: 0, rows: ['Pan tajado', 'Pan artesanal', 'Galletas', 'Ponqués', 'Tostadas / snacks'] },
  { code: 'B1', name: 'Cereales', type: 'center', color: '#EC4899', x: 0, y: 8, rows: ['Arroz blanco / integral', 'Cereales desayuno', 'Avena', 'Quinua / otros'] },
  { code: 'B2', name: 'Granos', type: 'center', color: '#EAB308', x: 5, y: 8, rows: ['Fríjoles', 'Lentejas', 'Arveja / garbanzo', 'Maíz / otros'] },
  { code: 'B3', name: 'Conservas', type: 'center', color: '#F59E0B', x: 9, y: 8, rows: ['Atún / sardinas', 'Verduras enlatadas', 'Salsas / condimentos', 'Aceites / vinagres'] },
  { code: 'C1', name: 'Abarrotes', type: 'center', color: '#6B7280', x: 0, y: 14, rows: ['Café y chocolate', 'Azúcar y panela', 'Harinas', 'Especias'] },
  { code: 'C2', name: 'Aceites', type: 'center', color: '#F97316', x: 5, y: 14, rows: ['Aceite girasol', 'Aceite de oliva', 'Manteca', 'Margarina'] },
  { code: 'D1', name: 'Limpieza', type: 'wall', color: '#06B6D4', x: 0, y: 21, rows: ['Detergentes', 'Jabones corporales', 'Limpiapisos', 'Papel higiénico', 'Servilletas / toallas'] },
  { code: 'D2', name: 'Cuidado personal', type: 'wall', color: '#EC4899', x: 5, y: 21, rows: ['Shampoo / acond.', 'Cremas / lociones', 'Desodorantes', 'Cepillos / pasta dental', 'Afeitado'] },
  { code: 'D3', name: 'Verduras y frutas', type: 'wall', color: '#22C55E', x: 10, y: 21, rows: ['Tomates', 'Papas y tubérculos', 'Cebollas / ajos', 'Lechugas / verduras', 'Frutas'] },
];

const CHUNK = 500;

async function upsertShelf(client, branchId, def) {
  const width = def.type === 'wall' ? 4 : 3;
  const height = def.rows.length;
  const existing = (
    await client.query('SELECT id FROM shelves WHERE branch_id = $1 AND code = $2', [branchId, def.code])
  ).rows[0];

  let shelfId;
  if (existing) {
    shelfId = existing.id;
    await client.query(
      `UPDATE shelves SET name=$1, type=$2, color=$3, pos_x=$4, pos_y=$5, rotation=0,
         width=$6, height=$7, updated_at=now() WHERE id=$8`,
      [def.name, def.type, def.color, def.x, def.y, width, height, shelfId],
    );
    await client.query('DELETE FROM shelf_rows WHERE shelf_id = $1', [shelfId]);
  } else {
    const ins = await client.query(
      `INSERT INTO shelves (branch_id, code, name, type, color, width, height, pos_x, pos_y, rotation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0) RETURNING id`,
      [branchId, def.code, def.name, def.type, def.color, width, height, def.x, def.y],
    );
    shelfId = ins.rows[0].id;
  }

  for (let i = 0; i < def.rows.length; i++) {
    await client.query(
      'INSERT INTO shelf_rows (shelf_id, row_number, label) VALUES ($1,$2,$3)',
      [shelfId, i + 1, def.rows[i]],
    );
  }
  return shelfId;
}

async function seedBranch(client, branchId, branchCode) {
  // shelfIds[i] corresponde a EXAMPLE_SHELVES[i] (mismo orden en ambos entornos)
  const shelfIds = [];
  for (const def of EXAMPLE_SHELVES) {
    shelfIds.push(await upsertShelf(client, branchId, def));
  }
  console.log(`  • ${branchCode}: ${shelfIds.length} estanterías listas`);

  const variants = await client.query('SELECT id FROM product_variants ORDER BY id');
  const variantIds = variants.rows.map((r) => Number(r.id));
  console.log(`  • ${branchCode}: ${variantIds.length} productos por ubicar`);

  // Reemplazar ubicaciones por aleatorias (deterministas) — una por producto
  await client.query('DELETE FROM product_locations WHERE branch_id = $1', [branchId]);

  const values = [];
  for (const vid of variantIds) {
    const idx = Math.floor(RNG() * shelfIds.length);
    const rowNumber = Math.floor(RNG() * EXAMPLE_SHELVES[idx].rows.length) + 1;
    values.push([vid, branchId, shelfIds[idx], rowNumber]);
  }

  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    const params = [];
    const placeholders = chunk
      .map((_, j) => `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`)
      .join(', ');
    chunk.forEach((v) => params.push(...v));
    await client.query(
      `INSERT INTO product_locations (product_variant_id, branch_id, shelf_id, row_number)
       VALUES ${placeholders}`,
      params,
    );
  }
  console.log(`  ✓ ${branchCode}: ${variantIds.length} ubicaciones asignadas`);
}

async function main() {
  const client = await pool.connect();
  try {
    if (WIPE) {
      console.log('🧹 Wipe de estanterías / filas / ubicaciones…');
      await client.query('DELETE FROM product_locations');
      await client.query('DELETE FROM shelf_rows');
      await client.query('DELETE FROM shelves');
      for (const t of ['shelves', 'shelf_rows', 'product_locations']) {
        await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), 1, false)`);
      }
    }

    const branches = await client.query(
      'SELECT id, code FROM branches WHERE deleted_at IS NULL ORDER BY priority, name',
    );
    console.log(`🏪 Sucursales: ${branches.rows.length}`);
    for (const b of branches.rows) {
      await seedBranch(client, Number(b.id), b.code);
    }
    console.log('✅ Seed de estanterías y ubicaciones completado');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
