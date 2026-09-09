/**
 * Sincroniza los logos de marcas del carousel hacia la BD de Supabase
 * (backend/.env.development.local → PROD_DATABASE_URL, proyecto us-west-2).
 *
 * Reutiliza los assets que ya dejó fetch-brand-logos.js en la BD local
 * (misma cuenta Cloudinary → mismo checksum/path) y, si en Supabase hay una
 * marca del carousel sin equivalente local, la descarga directamente.
 *
 * Uso (desde backend/):
 *   node scripts/sync-brand-logos-supabase.js
 *   FORCE=1 node scripts/sync-brand-logos-supabase.js   # re-enlaza las que ya tienen logo
 */
const path = require('path');
const { Pool } = require('pg');
const { loadEnv, configCloudinary, ensureBrandLogos } = require('./brand-logo-lib');

const env = loadEnv(path.join(__dirname, '..', '.env.development.local'));
configCloudinary(env);

const LOCAL_URL = env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const REMOTE_URL = env.PROD_DATABASE_URL;

function remoteOptions(url) {
  const opts = { connectionString: url, max: 2 };
  if (/supabase\.com/.test(url)) {
    opts.ssl = { rejectUnauthorized: false }; // Supabase/pooler exige TLS
  }
  return opts;
}

async function buildLocalLookup(pool) {
  const map = new Map();
  const { rows } = await pool.query(
    `SELECT b.code, b.name, m.path, m.file_name, m.mime_type, m.size_bytes,
            m.checksum, m.alt_text
       FROM brands b
       JOIN media m ON m.id = b.logo_media_id
      WHERE b.logo_media_id IS NOT NULL
        AND b.deleted_at IS NULL
        AND m.path IS NOT NULL`,
  );
  for (const r of rows) {
    const meta = {
      path: r.path,
      file_name: r.file_name,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      checksum: r.checksum,
      alt_text: r.alt_text,
    };
    if (r.code) map.set(String(r.code), meta);
    if (r.name) map.set(String(r.name), meta);
  }
  return map;
}

async function main() {
  if (!REMOTE_URL) {
    console.error('❌ PROD_DATABASE_URL no está definida en .env.development.local');
    process.exit(1);
  }

  // Origen (local): tabla de logos ya resueltos, por code y por name.
  const localPool = new Pool({ connectionString: LOCAL_URL, max: 2 });
  const lookup = await buildLocalLookup(localPool);
  console.log(`[LOCAL] logos disponibles para reutilizar: ${lookup.size / 2}`);

  // Destino: Supabase (mismas reglas de carousel en esa BD).
  const remotePool = new Pool(remoteOptions(REMOTE_URL));
  const results = await ensureBrandLogos(remotePool, {
    label: 'SUPABASE',
    lookup: async (brand) => {
      const meta = lookup.get(String(brand.code ?? '')) ?? lookup.get(String(brand.name ?? ''));
      return meta ?? null;
    },
  });

  for (const r of results) {
    console.log(`  ${r.ok.padEnd(20)} ${r.name}${r.path ? `  → ${r.path}` : ''}`);
  }

  await localPool.end();
  await remotePool.end();
}

main().catch((err) => {
  console.error('❌ Error:', err?.message ?? err);
  process.exit(1);
});
