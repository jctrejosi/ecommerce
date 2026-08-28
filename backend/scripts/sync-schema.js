// Sync de esquema idempotente para producción.
//
// Corregir deriva de esquema cuando la BD ya tiene datos: drizzle-kit push se
// usa en local/CI, pero en Render no se ejecuta al arrancar, y migrate.js omite
// la migración si la BD ya está poblada. Este script agrega únicamente las
// columnas que faltan (ALTER ... IF NOT EXISTS) y es seguro ejecutarlo en cada
// arranque del contenedor.
//
// Uso:
//   DATABASE_URL=... DB_SSL=true node scripts/sync-schema.js
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ [sync-schema] DATABASE_URL no está definida');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 2,
  // Proveedores gestionados (Supabase/Neon/Render) exigen SSL.
  ssl:
    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Columnas que deben existir según drizzle/schema.ts. Cada entrada es
// idempotente: no falla ni altera datos si la columna ya existe.
const COLUMNS = [
  // picking: unidades alistadas por item (backend/src/modules/picking/*)
  `ALTER TABLE order_items
     ADD COLUMN IF NOT EXISTS picked_qty integer NOT NULL DEFAULT 0`,
  // picking: revisión de pedidos en la cola (complementa a picked_qty)
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS reviewed_at timestamptz`,
];

async function sync() {
  let client;
  try {
    client = await pool.connect();
    for (const stmt of COLUMNS) {
      try {
        await client.query(stmt);
        console.log(`✅ [sync-schema] ${stmt.split('\n')[0].trim()}...`);
      } catch (err) {
        if (err.code === '42P07') {
          // ya existe la columna
          console.log(`⏭️ [sync-schema] ya aplicado: ${stmt.split('\n')[0].trim()}`);
          continue;
        }
        throw err;
      }
    }
    console.log('✅ [sync-schema] esquema al día');
  } catch (error) {
    // No fatal: si la BD está caída el backend reintenta al arrancar y el
    // health check lo reporta. Pero avisamos alto y claro.
    console.error('⚠️ [sync-schema] error (el backend seguirá arrancando):', error.message);
  } finally {
    try {
      if (client) client.release();
    } catch {}
    await pool.end();
  }
}

sync();
