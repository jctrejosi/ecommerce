/**
 * Descarga un logo para las marcas habilitadas en el carousel de inicio de la
 * BD LOCAL (backend/.env.development.local → DATABASE_URL) y las deja visibles.
 *
 * Uso (desde backend/):
 *   node scripts/fetch-brand-logos.js
 *   FORCE=1 node scripts/fetch-brand-logos.js   # re-busca también las que ya tienen logo
 */
const path = require('path');
const { Pool } = require('pg');
const { loadEnv, configCloudinary, ensureBrandLogos } = require('./brand-logo-lib');

const env = loadEnv(path.join(__dirname, '..', '.env.development.local'));
configCloudinary(env);

async function main() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
    max: 2,
  });
  const results = await ensureBrandLogos(pool, { label: 'LOCAL' });
  for (const r of results) {
    console.log(`  ${r.ok.padEnd(20)} ${r.name}${r.path ? `  → ${r.path}` : ''}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Error:', err?.message ?? err);
  process.exit(1);
});
