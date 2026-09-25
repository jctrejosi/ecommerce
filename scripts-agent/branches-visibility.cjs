/**
 * Sucursales: visibilidad vs activa.
 *
 * 1) Asegura la columna branches.is_visible (idempotente).
 * 2) Muestra las sucursales (id, code, store_id, name, is_active, is_visible y
 *    cuántos productos en inventario tienen).
 * 3) Con APPLY=1 marca como activas+visibles las sucursales cuyo code está en
 *    TIDS y como inactivas+ocultas el resto.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/branches-visibility.cjs
 *   APPLY=1 TIDS=1,2,11 NODE_PATH=backend/node_modules node scripts-agent/branches-visibility.cjs
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const APPLY = process.env.APPLY === '1';
const TIDS = (process.env.TIDS || '1,2,11')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    // 1) Columna is_visible (idempotente).
    await db.query(
      `ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true`,
    );
    console.log('✅ columna branches.is_visible lista');

    // 2) Inspección.
    const rows = await db.query(
      `SELECT b.id, b.code, b.store_id, b.name, b.is_active, b.is_visible,
              count(i.id) FILTER (WHERE i.stock > 0)::int AS products
         FROM branches b
         LEFT JOIN inventory i ON i.branch_id = b.id
        WHERE b.deleted_at IS NULL
        GROUP BY b.id, b.code, b.store_id, b.name, b.is_active, b.is_visible
        ORDER BY b.id`,
    );
    console.log('\nSucursales:');
    for (const r of rows.rows) {
      console.log(
        `  id=${r.id} code=${r.code} store_id=${r.store_id} name="${r.name}" ` +
          `active=${r.is_active} visible=${r.is_visible} products=${r.products}`,
      );
    }

    // 3) Aplicar.
    if (APPLY) {
      await db.query('BEGIN');
      // Activas + visibles: las TID indicadas (por code).
      const on = await db.query(
        `UPDATE branches SET is_active = true, is_visible = true, updated_at = now()
          WHERE code = ANY($1::text[]) AND deleted_at IS NULL`,
        [TIDS],
      );
      // Inactivas + ocultas: el resto.
      const off = await db.query(
        `UPDATE branches SET is_active = false, is_visible = false, updated_at = now()
          WHERE code <> ALL($1::text[]) AND deleted_at IS NULL`,
        [TIDS],
      );
      await db.query('COMMIT');
      console.log(`\n✅ activas+visibles: ${on.rowCount} | inactivas+ocultas: ${off.rowCount}`);
    } else {
      console.log('\n(dry-run: no se aplicó nada. Usa APPLY=1 TIDS=... para aplicar.)');
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
