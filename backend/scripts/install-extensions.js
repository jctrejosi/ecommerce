const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  // Supabase/Neon/Render exigen SSL. DB_SSL=true activa TLS sin verificar cadena.
  ssl:
    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function installExtensions() {
  console.log('🔧 Instalando extensiones de PostgreSQL...');

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    console.log('✅ uuid-ossp instalado');

    // Buscador del catálogo
    await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent;');
    console.log('✅ unaccent instalado (búsqueda insensible a tildes/ñ)');

    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    console.log('✅ pg_trgm instalado (búsqueda difusa / tolerante a tipeos)');

    // Wrapper IMMUTABLE de unaccent() para poder usarlo en índices.
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      AS $$ SELECT public.unaccent($1) $$;
    `);
    console.log('✅ immutable_unaccent() creado (búsqueda indexable sin tildes/ñ)');

    // Verificar
    const r = await pool.query('SELECT uuid_generate_v4()');
    console.log(`✅ UUID generado: ${r.rows[0].uuid_generate_v4}`);
  } catch (error) {
    console.error('❌ Error instalando extensiones:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

installExtensions();
